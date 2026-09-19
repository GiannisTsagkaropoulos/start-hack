# Viseca Control Layer

Turns a customer instruction into a validated local mandate, compiles its Viseca API payload, and evaluates authorization events deterministically.

## Run

```powershell
python database/build_database.py
python -m unittest discover -s tests
python -m pip install -r requirements.txt
uvicorn api:app --reload
```

`models/custom_mandate/` contains the richer local policy; `models/viseca_api/` contains the Viseca `POST /v1/mandates` payload. API request and response contracts are in `models/api_contracts.py`.

Policy generation and authorization evaluation live in `services/`; database setup remains in `database/`.

The retained authorization-event field-usage table is [database/AUTHORIZATION_EVENT_FIELD_USAGE.md](database/AUTHORIZATION_EVENT_FIELD_USAGE.md).
