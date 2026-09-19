"""Build the local Viseca 2026 control-layer database.

Uses only Python's stdlib sqlite3 module.  SQLite is a good fit for the
latency-sensitive decision path: it is embedded (no network hop), ACID, and
the indexes below make card/history and scenario lookups logarithmic.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "viseca-2026" / "data"
DEFAULT_DB = ROOT / "viseca_control.db"

DDL = """
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA busy_timeout = 3000;

CREATE TABLE data_pack (
  pack_version TEXT PRIMARY KEY, classification TEXT NOT NULL, package TEXT NOT NULL,
  visibility TEXT NOT NULL, history_start TEXT NOT NULL, history_end TEXT NOT NULL,
  loaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE source_files (
  path TEXT PRIMARY KEY, format TEXT NOT NULL, expected_rows INTEGER,
  sha256 TEXT NOT NULL, verified INTEGER NOT NULL CHECK(verified IN (0,1))
) STRICT;

CREATE TABLE customers (
  customer_id TEXT PRIMARY KEY, persona_name TEXT NOT NULL, home_region TEXT NOT NULL,
  background TEXT NOT NULL, shopping_preferences TEXT NOT NULL, typical_spending TEXT NOT NULL,
  budget_style TEXT NOT NULL, travel_pattern TEXT NOT NULL
) STRICT;
CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  account_type TEXT NOT NULL CHECK(account_type IN ('credit','debit','prepaid')),
  account_purpose TEXT NOT NULL, base_currency TEXT NOT NULL CHECK(base_currency IN ('CHF','EUR','GBP','USD')),
  status TEXT NOT NULL, opened_on TEXT NOT NULL, per_transaction_limit_chf REAL NOT NULL CHECK(per_transaction_limit_chf >= 0),
  monthly_limit_chf REAL NOT NULL CHECK(monthly_limit_chf >= 0)
) STRICT;
CREATE TABLE cards (
  card_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(account_id),
  card_type TEXT NOT NULL, card_purpose TEXT NOT NULL, status TEXT NOT NULL,
  first_used_on TEXT NOT NULL, expires_on TEXT NOT NULL,
  online_enabled INTEGER NOT NULL CHECK(online_enabled IN (0,1)),
  international_enabled INTEGER NOT NULL CHECK(international_enabled IN (0,1)),
  virtual_card INTEGER NOT NULL CHECK(virtual_card IN (0,1))
) STRICT;
CREATE TABLE merchants (
  merchant_id TEXT PRIMARY KEY, merchant_name TEXT NOT NULL, merchant_category TEXT NOT NULL,
  merchant_mcc TEXT NOT NULL CHECK(length(merchant_mcc)=4), merchant_country TEXT NOT NULL CHECK(length(merchant_country)=2),
  merchant_city TEXT NOT NULL, availability TEXT NOT NULL,
  recurring_capable INTEGER NOT NULL CHECK(recurring_capable IN (0,1))
) STRICT;
CREATE TABLE items (
  item_id TEXT PRIMARY KEY, item_name TEXT NOT NULL, item_category TEXT NOT NULL,
  item_description TEXT NOT NULL, unit_price_min_chf REAL NOT NULL CHECK(unit_price_min_chf >= 0),
  unit_price_typical_chf REAL NOT NULL CHECK(unit_price_typical_chf >= 0),
  unit_price_max_chf REAL NOT NULL CHECK(unit_price_max_chf >= unit_price_typical_chf AND unit_price_typical_chf >= unit_price_min_chf)
) STRICT;
CREATE TABLE fx_rates (
  from_currency TEXT NOT NULL CHECK(from_currency IN ('CHF','EUR','GBP','USD')),
  to_currency TEXT NOT NULL CHECK(to_currency = 'CHF'), rate REAL NOT NULL CHECK(rate > 0),
  rate_date TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(from_currency, to_currency, rate_date)
) STRICT;

CREATE TABLE scenario_catalogue (
  scenario_id TEXT PRIMARY KEY, scenario_name TEXT NOT NULL, cardholder_instruction TEXT NOT NULL,
  control_question TEXT NOT NULL, control_theme TEXT NOT NULL, event_count INTEGER NOT NULL CHECK(event_count >= 0),
  short_rationale TEXT NOT NULL
) STRICT;
CREATE TABLE scenario_authorities (
  authority_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  card_id TEXT NOT NULL REFERENCES cards(card_id), valid_from TEXT NOT NULL, valid_until TEXT NOT NULL,
  initial_status TEXT NOT NULL CHECK(initial_status IN ('active','revoked','expired')), CHECK(valid_until >= valid_from)
) STRICT;
CREATE TABLE purchase_attempts (
  authorization_id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL REFERENCES scenario_catalogue(scenario_id),
  replay_order INTEGER NOT NULL CHECK(replay_order > 0), authority_id TEXT NOT NULL REFERENCES scenario_authorities(authority_id),
  card_id TEXT NOT NULL REFERENCES cards(card_id), merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  timestamp TEXT NOT NULL, amount REAL NOT NULL CHECK(amount >= 0), currency TEXT NOT NULL CHECK(currency IN ('CHF','EUR','GBP','USD')),
  billing_amount_chf REAL NOT NULL CHECK(billing_amount_chf >= 0), items_subtotal REAL NOT NULL CHECK(items_subtotal >= 0),
  delivery_fee REAL NOT NULL CHECK(delivery_fee >= 0), channel TEXT NOT NULL, customer_device_id TEXT,
  authority_status TEXT NOT NULL CHECK(authority_status IN ('active','revoked','expired')),
  card_status_at_attempt TEXT NOT NULL CHECK(card_status_at_attempt IN ('active','blocked')),
  spend_in_period_before_chf REAL, recent_attempt_count_10m INTEGER NOT NULL CHECK(recent_attempt_count_10m >= 0),
  fulfillment_method TEXT NOT NULL, delivery_by TEXT,
  order_returnable TEXT CHECK(order_returnable IN ('true','false','unknown','not_applicable')),
  order_cancellable TEXT, related_authorization_id TEXT REFERENCES purchase_attempts(authorization_id),
  related_authorization_status TEXT, purchase_description TEXT NOT NULL,
  UNIQUE(scenario_id, replay_order)
) STRICT;
CREATE TABLE purchase_attempt_items (
  authorization_id TEXT NOT NULL REFERENCES purchase_attempts(authorization_id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL CHECK(line_no > 0), item_id TEXT NOT NULL REFERENCES items(item_id),
  item_name TEXT NOT NULL, item_category TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0), currency TEXT NOT NULL CHECK(currency IN ('CHF','EUR','GBP','USD')),
  item_details TEXT NOT NULL, PRIMARY KEY(authorization_id, line_no)
) STRICT;
CREATE TABLE authorization_history (
  authorization_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  account_id TEXT NOT NULL REFERENCES accounts(account_id), card_id TEXT NOT NULL REFERENCES cards(card_id),
  initiator_type TEXT NOT NULL CHECK(initiator_type IN ('human','agent','merchant')), timestamp TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('purchase','refund','cash_withdrawal')),
  status TEXT NOT NULL CHECK(status IN ('approved','declined')), amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('CHF','EUR','GBP','USD')), billing_amount_chf REAL NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id), merchant_name TEXT NOT NULL, merchant_category TEXT NOT NULL,
  merchant_mcc TEXT NOT NULL, merchant_country TEXT NOT NULL, merchant_city TEXT NOT NULL, channel TEXT NOT NULL,
  card_present INTEGER NOT NULL CHECK(card_present IN (0,1)), recurring INTEGER NOT NULL CHECK(recurring IN (0,1)),
  customer_device_id TEXT, description TEXT NOT NULL, related_transaction_id TEXT REFERENCES authorization_history(authorization_id),
  account_type TEXT NOT NULL, account_purpose TEXT NOT NULL, base_currency TEXT NOT NULL,
  per_transaction_limit_chf REAL NOT NULL, monthly_limit_chf REAL NOT NULL, card_purpose TEXT NOT NULL,
  card_status TEXT NOT NULL, online_enabled INTEGER NOT NULL CHECK(online_enabled IN (0,1)),
  international_enabled INTEGER NOT NULL CHECK(international_enabled IN (0,1)), virtual_card INTEGER NOT NULL CHECK(virtual_card IN (0,1)),
  customer_home_region TEXT NOT NULL, customer_budget_style TEXT NOT NULL, customer_persona_name TEXT NOT NULL,
  approved_spend_before_chf REAL NOT NULL, approved_merchant_transaction_count_before INTEGER NOT NULL,
  approved_device_transaction_count_before INTEGER NOT NULL, last_approved_at TEXT
) STRICT;

-- Runtime tables are deliberately separate from immutable supplied fixtures.
CREATE TABLE mandates (
  mandate_id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(customer_id), instruction TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','active','revoked','expired')), uncertainty_policy TEXT NOT NULL CHECK(uncertainty_policy IN ('ask','approve','decline')),
  created_at TEXT NOT NULL, confirmed_at TEXT, revoked_at TEXT
) STRICT;
CREATE TABLE mandate_rules (
  rule_id INTEGER PRIMARY KEY, mandate_id TEXT NOT NULL REFERENCES mandates(mandate_id) ON DELETE CASCADE,
  field TEXT NOT NULL, operator TEXT NOT NULL, value_json TEXT NOT NULL, currency TEXT, scope TEXT NOT NULL
) STRICT;
CREATE TABLE decisions (
  authorization_id TEXT PRIMARY KEY REFERENCES purchase_attempts(authorization_id), mandate_id TEXT REFERENCES mandates(mandate_id),
  decision TEXT NOT NULL CHECK(decision IN ('approve','decline','step_up')), status TEXT NOT NULL CHECK(status IN ('submitted','resolved','failed')),
  decided_at TEXT NOT NULL, resolved_at TEXT, reason_codes_json TEXT NOT NULL DEFAULT '[]', evidence_json TEXT NOT NULL DEFAULT '[]', customer_message TEXT, engine_version TEXT
) STRICT;

CREATE INDEX idx_accounts_customer ON accounts(customer_id);
CREATE INDEX idx_cards_account ON cards(account_id);
CREATE INDEX idx_history_card_time ON authorization_history(card_id, timestamp DESC);
CREATE INDEX idx_history_customer_time ON authorization_history(customer_id, timestamp DESC);
CREATE INDEX idx_history_card_merchant_approved ON authorization_history(card_id, merchant_id, timestamp DESC) WHERE status='approved';
CREATE INDEX idx_history_card_device_approved ON authorization_history(card_id, customer_device_id, timestamp DESC) WHERE status='approved' AND customer_device_id IS NOT NULL;
CREATE INDEX idx_attempts_scenario_order ON purchase_attempts(scenario_id, replay_order);
CREATE INDEX idx_attempts_card_time ON purchase_attempts(card_id, timestamp);
CREATE INDEX idx_attempt_items_item ON purchase_attempt_items(item_id);
CREATE INDEX idx_decisions_mandate_status ON decisions(mandate_id, status);

CREATE VIEW scenario_purchase_context AS
SELECT p.*, s.cardholder_instruction, a.customer_id, m.merchant_name, m.merchant_category, m.merchant_mcc,
       c.account_id, c.online_enabled, c.international_enabled, c.virtual_card
FROM purchase_attempts p JOIN scenario_catalogue s USING(scenario_id)
JOIN scenario_authorities a USING(authority_id) JOIN merchants m USING(merchant_id) JOIN cards c USING(card_id);
CREATE VIEW approved_decision_spend AS
SELECT p.scenario_id, p.authorization_id, p.timestamp, p.billing_amount_chf,
       COALESCE(SUM(p.billing_amount_chf) OVER (PARTITION BY p.scenario_id ORDER BY p.timestamp, p.authorization_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0.0) AS approved_spend_before_chf
FROM purchase_attempts p JOIN decisions d USING(authorization_id)
WHERE d.decision='approve' AND d.status='resolved';
"""

BOOLS = {'true': 1, 'false': 0}
NUMERIC = {'amount','billing_amount_chf','items_subtotal','delivery_fee','spend_in_period_before_chf','unit_price','rate','unit_price_min_chf','unit_price_typical_chf','unit_price_max_chf','per_transaction_limit_chf','monthly_limit_chf','approved_spend_before_chf'}
INTEGERS = {'replay_order','recent_attempt_count_10m','line_no','quantity','approved_merchant_transaction_count_before','approved_device_transaction_count_before','event_count'}
BOOLEAN = {'online_enabled','international_enabled','virtual_card','recurring_capable','card_present','recurring'}

TABLES = ('customers','accounts','cards','merchants','items','fx_rates','scenario_catalogue','scenario_authorities','purchase_attempts','purchase_attempt_items','authorization_history')

def convert(key: str, value: str) -> Any:
    if value == '': return None
    if key in BOOLEAN: return BOOLS[value]
    if key in INTEGERS: return int(value)
    if key in NUMERIC: return float(value)
    return value

def validate_manifest(data_dir: Path, manifest: dict[str, Any]) -> list[tuple[str, str, int | None, str, int]]:
    result = []
    for item in manifest['files']:
        file = data_dir / item['path']
        content = file.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        # Git's Windows checkout can CRLF-normalize text files.  Accept the
        # manifest's LF representation as well; binary content still requires
        # a byte-for-byte match.
        normalized_digest = hashlib.sha256(content.replace(b'\r\n', b'\n')).hexdigest()
        if digest != item['sha256'] and normalized_digest != item['sha256']:
            raise ValueError(f"SHA-256 mismatch: {file}")
        result.append((item['path'], item['format'], item.get('rows'), digest, 1))
    return result

def load_csv(connection: sqlite3.Connection, data_dir: Path, table: str) -> None:
    with (data_dir / f'{table}.csv').open(encoding='utf-8', newline='') as stream:
        rows = list(csv.DictReader(stream))
    if not rows: return
    columns = list(rows[0])
    placeholders = ','.join('?' for _ in columns)
    sql = f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})"
    connection.executemany(sql, [[convert(k, row[k]) for k in columns] for row in rows])

def build(data_dir: Path, database: Path) -> None:
    manifest = json.loads((data_dir / 'metadata.json').read_text(encoding='utf-8'))
    if database.exists(): database.unlink()
    con = sqlite3.connect(database)
    try:
        con.executescript(DDL)
        with con:
            con.execute('INSERT INTO data_pack VALUES (?,?,?,?,?,?,strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))',
                        (manifest['pack_version'], manifest['classification'], manifest['package'], manifest['visibility'], manifest['history_period']['start'], manifest['history_period']['end']))
            con.executemany('INSERT INTO source_files VALUES (?,?,?,?,?)', validate_manifest(data_dir, manifest))
            # Parents precede children; history self-FKs are safe because source is chronological.
            for table in TABLES: load_csv(con, data_dir, table)
            problems = con.execute('PRAGMA foreign_key_check').fetchall()
            if problems: raise ValueError(f'Foreign-key violations: {problems[:3]}')
        con.execute('ANALYZE')
        con.execute('PRAGMA optimize')
    finally:
        con.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build the indexed Viseca SQLite database.')
    parser.add_argument('--data-dir', type=Path, default=DEFAULT_DATA)
    parser.add_argument('--database', type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    build(args.data_dir.resolve(), args.database.resolve())
    print(f'Created {args.database.resolve()}')
