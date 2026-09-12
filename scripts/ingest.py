#!/usr/bin/env python3
"""
ingest.py - Ingests PersonT.txt and transforms it into structured JSON.

Supports:
  1. Base mode (default):
     - Parses all rows faithfully.
     - Maps Gender ('Yes' -> 'Male', 'No' -> 'Female').
     - Converts FatherID and MotherID to integer or null.
     - Leaves Wikipedia as "" and Category as [] for manual editing.
     - Preserves the full description in Description.
  2. Enriched mode (--enrich):
     - Automatically classifies entities into categories (e.g. Primordial, Titan, Olympian, Nymph, Mortal).
     - Generates Wikipedia URLs based on entity names and mythology disambiguations.
     - Infers missing character names (e.g., ID 10 -> Hemera).
"""

import argparse
import json
import os
import re
import sys
import urllib.parse
from typing import Any, Dict, List, Optional


def parse_row_cells(line: str) -> Optional[List[str]]:
    """Splits an ASCII table row into stripped cells, ignoring dividers and headers."""
    stripped = line.strip()
    if not stripped.startswith('|') or not stripped.endswith('|'):
        return None
    cells = [c.strip() for c in stripped.split('|')[1:-1]]
    if not cells or cells[0].lower() == 'personid':
        return None
    return cells


def extract_categories_from_desc(name: str, desc: str) -> List[str]:
    """Infers categories based on description text and mythos roles."""
    categories: List[str] = []
    d_lower = desc.lower()

    # Primordial
    if 'primordial' in d_lower:
        categories.append('Primordial')

    # Titan / Titaness
    if 'titaness' in d_lower:
        categories.append('Titaness')
    elif 'titan' in d_lower and 'titaness' not in categories:
        categories.append('Titan')

    # Olympian
    if 'olympian' in d_lower:
        categories.append('Olympian')

    # Specific groups
    if 'cyclop' in d_lower:
        categories.append('Cyclopes')
    if 'hecantonchire' in d_lower or 'hecatoncheir' in d_lower:
        categories.append('Hecatoncheires')
    if 'muse' in d_lower:
        categories.append('Muse')
    if 'charite' in d_lower or 'grace' in d_lower:
        categories.append('Charites')
    if 'horae' in d_lower:
        categories.append('Horae')
    if 'fate' in d_lower:
        categories.append('Moirai')
    if 'furies' in d_lower or 'fury' in d_lower:
        categories.append('Erinyes')
    if 'gorgon' in d_lower:
        categories.append('Gorgon')
    if 'erotes' in d_lower:
        categories.append('Erotes')

    # Nymphs
    if 'oceanid' in d_lower:
        categories.append('Oceanid')
        categories.append('Nymph')
    elif 'nereid' in d_lower:
        categories.append('Nereid')
        categories.append('Nymph')
    elif 'naiad' in d_lower:
        categories.append('Naiad')
        categories.append('Nymph')
    elif 'pleiad' in d_lower:
        categories.append('Pleiad')
        categories.append('Nymph')
    elif 'hyad' in d_lower:
        categories.append('Hyades')
        categories.append('Nymph')
    elif 'nymph' in d_lower and 'Nymph' not in categories:
        categories.append('Nymph')

    # Nature & Rivers
    if 'river' in d_lower or 'potamoi' in d_lower:
        categories.append('Potamoi')
    if 'wind' in d_lower and ('god' in d_lower or 'anemoi' in d_lower):
        categories.append('Anemoi')

    # Monsters / Creatures
    if any(k in d_lower for k in ['monster', 'serpent', 'dog guardian', 'dragon', 'centaur']):
        categories.append('Monster')

    # Mortals / Royalty
    if any(k in d_lower for k in ['king', 'queen', 'prince', 'princess', 'founder', 'mortal', 'eponym', 'hero']):
        categories.append('Mortal')
        if any(k in d_lower for k in ['king', 'queen', 'prince', 'princess', 'ruler']):
            categories.append('Royalty')

    # Deities & Demigods
    if 'demigod' in d_lower:
        categories.append('Demigod')
    elif any(k in d_lower for k in ['god of', 'goddess of', 'sea god', 'god ', 'goddess ']):
        if 'God' not in categories and 'Goddess' not in categories:
            if 'goddess' in d_lower:
                categories.append('Goddess')
            else:
                categories.append('God')

    # Deduplicate while preserving order
    seen = set()
    deduped = []
    for cat in categories:
        if cat not in seen:
            seen.add(cat)
            deduped.append(cat)
    return deduped


# Specific Wikipedia article titles for Greek mythological figures requiring disambiguation
WIKIPEDIA_OVERRIDES: Dict[str, str] = {
    "Gaia": "Gaia",
    "Ouranos": "Uranus_(mythology)",
    "Kronos": "Cronus",
    "Zeus": "Zeus",
    "Hera": "Hera",
    "Poseidon": "Poseidon",
    "Hades": "Hades",
    "Demeter": "Demeter",
    "Hestia": "Hestia",
    "Ares": "Ares",
    "Athena": "Athena",
    "Apollo": "Apollo",
    "Artemis": "Artemis",
    "Aphrodite": "Aphrodite",
    "Hephaestus": "Hephaestus",
    "Hermes": "Hermes",
    "Dionysus": "Dionysus",
    "Thalia (Muse)": "Thalia_(Muse)",
    "Thalia (Charis)": "Thalia_(Grace)",
    "Nilus": "Nilus_(mythology)",
    "Clymene": "Clymene_(Oceanid)",
    "Metis": "Metis_(mythology)",
    "Eos": "Eos",
    "Atlas": "Atlas_(mythology)",
    "Prometheus": "Prometheus",
    "Epimetheus": "Epimetheus",
    "Typhon": "Typhon",
    "Eris": "Eris_(mythology)",
    "Nemesis": "Nemesis",
    "Charon": "Charon",
    "Hypnos": "Hypnos",
    "Thanatos": "Thanatos",
    "Styx": "Styx",
    "Acheron": "Acheron",
    "Lethe": "Lethe",
    "Cocytus": "Cocytus",
    "Phlegethon": "Phlegethon",
    "Echidna": "Echidna_(mythology)",
    "Kerberos": "Cerberus",
    "Hydra": "Lernaean_Hydra",
    "Nereus": "Nereus",
    "Doris": "Doris_(mythology)",
    "Triton": "Triton_(mythology)",
    "Eros": "Eros",
    "Psyche": "Psyche_(mythology)",
    "Sisyphus": "Sisyphus",
    "Tantalus": "Tantalus",
    "Pelops": "Pelops",
    "Niobe": "Niobe",
    "Aeolus": "Aeolus_(son_of_Hellen)",
    "Hemera": "Hemera",
}


def get_wikipedia_url(name: str, person_id: int) -> str:
    """Generates an accurate Wikipedia link for a mythological figure."""
    if not name:
        if person_id == 10:
            return "https://en.wikipedia.org/wiki/Hemera"
        return ""

    if name == "Thalia":
        if person_id == 69:
            return "https://en.wikipedia.org/wiki/Thalia_(Muse)"
        elif person_id == 74:
            return "https://en.wikipedia.org/wiki/Thalia_(Grace)"

    if name in WIKIPEDIA_OVERRIDES:
        slug = WIKIPEDIA_OVERRIDES[name]
        return f"https://en.wikipedia.org/wiki/{slug}"

    # Default URL encoding
    slug = urllib.parse.quote(name.replace(' ', '_'))
    return f"https://en.wikipedia.org/wiki/{slug}"


def parse_file(
    filepath: str,
    enrich: bool = False,
    raw_gender: bool = False,
    null_as_zero: bool = False,
) -> List[Dict[str, Any]]:
    """Parses PersonT.txt into a list of structured character dictionaries."""
    records = []

    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            cells = parse_row_cells(line)
            if not cells:
                continue

            # Expected layout:
            # cells[0]: PersonID
            # cells[1]: PersonName
            # cells[2]: Gender
            # cells[3]: MotherID
            # cells[4]: FatherID
            # cells[5]: Description
            if len(cells) < 6:
                continue

            pid_str, name, gender_val, mid_str, fid_str, desc = cells[:6]

            # Parse ID
            try:
                person_id = int(pid_str)
            except ValueError:
                continue

            # If name is missing for ID 10 (daughter of Nyx & Erebus, goddess of day)
            if not name and person_id == 10:
                if enrich:
                    name = "Hemera"

            # Parse Gender
            if raw_gender:
                gender = gender_val
            else:
                gender = "Male" if gender_val.strip().lower() == "yes" else "Female"

            # Parse Parent IDs (MotherID is col 3, FatherID is col 4)
            def parse_parent_id(val_str: str) -> Optional[int]:
                clean = val_str.strip()
                if not clean or clean == '0':
                    return 0 if null_as_zero else None
                try:
                    num = int(clean)
                    return num if num != 0 else (0 if null_as_zero else None)
                except ValueError:
                    return 0 if null_as_zero else None

            mother_id = parse_parent_id(mid_str)
            father_id = parse_parent_id(fid_str)

            # Categories and Wikipedia
            if enrich:
                category = extract_categories_from_desc(name, desc)
                wikipedia = get_wikipedia_url(name, person_id)
            else:
                category = []
                wikipedia = ""

            record = {
                "ID": person_id,
                "Name": name,
                "Gender": gender,
                "FatherID": father_id,
                "MotherID": mother_id,
                "Wikipedia": wikipedia,
                "Category": category,
                "Description": desc,
            }
            records.append(record)

    return records


def main():
    parser = argparse.ArgumentParser(
        description="Ingest and transform PersonT.txt into clean JSON."
    )
    default_input = os.path.join("data", "PersonT.txt") if os.path.exists(os.path.join("data", "PersonT.txt")) else "PersonT.txt"
    default_output = os.path.join("data", "characters.json")

    parser.add_argument(
        "-i", "--input", default=default_input, help=f"Path to input table file (default: {default_input})"
    )
    parser.add_argument(
        "-o", "--output", default=default_output, help=f"Path to output JSON file (default: {default_output})"
    )
    parser.add_argument(
        "--no-enrich",
        action="store_true",
        help="Disable automatic extraction of categories, Wikipedia URLs, and missing names.",
    )
    parser.add_argument(
        "--raw-gender",
        action="store_true",
        help="Keep raw Gender values ('Yes'/'No') instead of mapping to 'Male'/'Female'.",
    )
    parser.add_argument(
        "--null-as-zero",
        action="store_true",
        help="Keep missing/unknown parent IDs as 0 instead of null.",
    )
    parser.add_argument(
        "--indent", type=int, default=2, help="JSON indentation level (default: 2)"
    )

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: Input file '{args.input}' does not exist.", file=sys.stderr)
        sys.exit(1)

    enrich = not args.no_enrich

    records = parse_file(
        args.input,
        enrich=enrich,
        raw_gender=args.raw_gender,
        null_as_zero=args.null_as_zero,
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=args.indent, ensure_ascii=False)

    # Also generate characters.js wrapper if outputting characters.json
    if args.output.endswith("characters.json"):
        js_path = args.output[:-5] + ".js"
        with open(js_path, "w", encoding="utf-8") as f:
            f.write("// Auto-generated data wrapper for direct file:// browser support\nwindow.MYTHOS_DATA = ")
            json.dump(records, f, indent=args.indent, ensure_ascii=False)
            f.write(";\n")
        print(f"Generated browser data module: '{js_path}'")

    print(f"Successfully processed {len(records)} records from '{args.input}' -> '{args.output}'.")


if __name__ == "__main__":
    main()

