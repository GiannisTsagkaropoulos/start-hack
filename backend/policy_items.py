from __future__ import annotations

from typing import Any


def merge_duplicate_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge repeated LLM/UI item rows into one cumulative quantity allowance.

    Rows are only merged when name, category, and unit-price ceiling agree, so
    differently priced variants remain separate mandate items.
    """
    merged: list[dict[str, Any]] = []
    positions: dict[tuple[str, Any, Any], int] = {}

    for item in items:
        normalized_name = str(item.get("name") or "").strip().casefold()
        key = (normalized_name, item.get("category"), item.get("max_price_per_item"))
        existing_index = positions.get(key)
        if existing_index is None:
            positions[key] = len(merged)
            merged.append(dict(item))
            continue

        existing_quantity = merged[existing_index].get("quantity")
        incoming_quantity = item.get("quantity")
        if isinstance(existing_quantity, int) and isinstance(incoming_quantity, int):
            merged[existing_index]["quantity"] = existing_quantity + incoming_quantity
        elif existing_quantity is None:
            merged[existing_index]["quantity"] = incoming_quantity

    return merged
