from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import struct
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

import olefile
import psycopg
import bcrypt
from dotenv import dotenv_values
from PIL import Image
from slugify import slugify


ROOT = Path(__file__).resolve().parents[1]
INPUT_DOC = ROOT / "input-doc"
MEDIA_ROOT = ROOT / "var" / "media" / "seed"
ENV_FILE = ROOT / "backend" / ".env.local"
SCHEMA_FILE = ROOT / "db" / "schema.sql"

LANGUAGES = ("hr", "en", "de")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
IMAGE_URL_RE = re.compile(r'https?://[^\s\"]+\.(?:jpg|jpeg|png|webp)', re.IGNORECASE)
STEP_PREFIX_RE = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩\d]+[.)]?\s*")
TITLE_STOPWORDS = {
    "sadržaj",
    "recepti",
    "potrebni sastojci",
    "sastojci",
    "potrebno",
    "priprema",
    "postupak izrade",
    "način pripreme",
    "napomena",
    "savjet",
    "raspored slaganja",
    "mirodije",
}
FRACTIONS = {
    "½": Decimal("0.5"),
    "¼": Decimal("0.25"),
    "¾": Decimal("0.75"),
    "⅓": Decimal("0.333"),
    "⅔": Decimal("0.667"),
}
UNIT_ALIASES = {
    "kg": "kg",
    "g": "g",
    "dag": "g",
    "dkg": "g",
    "ml": "ml",
    "dl": "ml",
    "l": "ml",
    "lit": "ml",
    "lit.": "ml",
    "žlica": "tbsp",
    "žlice": "tbsp",
    "žličica": "tsp",
    "žličice": "tsp",
    "vrećica": "packet",
    "vrećice": "packet",
    "kom": "piece",
    "komada": "piece",
    "kriške": "slice",
    "glavica": "piece",
    "glavice": "piece",
    "jaje": "piece",
    "jaja": "piece",
    "bjelanjak": "piece",
    "bjelanjka": "piece",
    "žutanjak": "piece",
    "žutanjka": "piece",
    "kutija": "box",
    "kutije": "box",
    "režanj": "clove",
    "režnja": "clove",
}
UNIT_SCALES = {
    "dag": Decimal("10"),
    "dkg": Decimal("10"),
    "dl": Decimal("100"),
    "l": Decimal("1000"),
    "lit": Decimal("1000"),
    "lit.": Decimal("1000"),
}
DEFAULT_ACTION_CODES = [
    "auth.registered",
    "recipe.created",
    "media.uploaded",
]


CATEGORIES = {
    "soups": {"hr": "Juhe i variva", "en": "Soups & Stews", "de": "Suppen & Eintöpfe"},
    "main-dishes": {"hr": "Glavna jela", "en": "Main Dishes", "de": "Hauptgerichte"},
    "desserts": {"hr": "Deserti", "en": "Desserts", "de": "Desserts"},
    "baking": {"hr": "Pekarstvo i tijesta", "en": "Baking & Doughs", "de": "Backen & Teige"},
    "preserves": {"hr": "Zimnica i namazi", "en": "Preserves & Spreads", "de": "Eingemachtes & Aufstriche"},
    "drinks": {"hr": "Pića i sirupi", "en": "Drinks & Syrups", "de": "Getränke & Sirupe"},
}

TAGS = {
    "traditional": {"hr": "tradicionalno", "en": "traditional", "de": "traditionell"},
    "chicken": {"hr": "piletina", "en": "chicken", "de": "Huhn"},
    "vegetarian": {"hr": "vegetarijansko", "en": "vegetarian", "de": "vegetarisch"},
    "pasta": {"hr": "tjestenina", "en": "pasta", "de": "Pasta"},
    "meat": {"hr": "meso", "en": "meat", "de": "Fleisch"},
    "oven-baked": {"hr": "iz pećnice", "en": "oven baked", "de": "aus dem Ofen"},
    "cookies": {"hr": "keksi", "en": "cookies", "de": "Kekse"},
    "cake": {"hr": "kolač", "en": "cake", "de": "Kuchen"},
    "torte": {"hr": "torta", "en": "torte", "de": "Torte"},
    "fruit": {"hr": "voćno", "en": "fruit", "de": "fruchtig"},
    "citrus": {"hr": "citrusi", "en": "citrus", "de": "Zitrus"},
    "preserve": {"hr": "zimnica", "en": "preserve", "de": "Eingemachtes"},
    "yeast-dough": {"hr": "dizano tijesto", "en": "yeast dough", "de": "Hefeteig"},
}

INGREDIENT_TRANSLATIONS = {
    "almonds": {"hr": "bademi", "en": "almonds", "de": "Mandeln"},
    "apple": {"hr": "jabuka", "en": "apple", "de": "Apfel"},
    "apricot jam": {"hr": "pekmez od marelice", "en": "apricot jam", "de": "Aprikosenmarmelade"},
    "baking powder": {"hr": "prašak za pecivo", "en": "baking powder", "de": "Backpulver"},
    "bay leaf": {"hr": "lovor", "en": "bay leaf", "de": "Lorbeerblatt"},
    "beef": {"hr": "junetina", "en": "beef", "de": "Rindfleisch"},
    "biscuits": {"hr": "keksi", "en": "biscuits", "de": "Kekse"},
    "butter": {"hr": "maslac", "en": "butter", "de": "Butter"},
    "cabbage": {"hr": "kupus", "en": "cabbage", "de": "Kohl"},
    "carrot": {"hr": "mrkva", "en": "carrot", "de": "Karotte"},
    "celery root": {"hr": "korijen celera", "en": "celery root", "de": "Knollensellerie"},
    "cheese": {"hr": "sir", "en": "cheese", "de": "Käse"},
    "cherry": {"hr": "višnja", "en": "sour cherry", "de": "Sauerkirsche"},
    "chicken": {"hr": "piletina", "en": "chicken", "de": "Huhn"},
    "chicken liver": {"hr": "pileća jetrica", "en": "chicken liver", "de": "Hühnerleber"},
    "chocolate": {"hr": "čokolada", "en": "chocolate", "de": "Schokolade"},
    "coconut": {"hr": "kokos", "en": "coconut", "de": "Kokosnuss"},
    "coffee": {"hr": "kava", "en": "coffee", "de": "Kaffee"},
    "caramel": {"hr": "karamel", "en": "caramel", "de": "Karamell"},
    "cinnamon": {"hr": "cimet", "en": "cinnamon", "de": "Zimt"},
    "cocoa powder": {"hr": "kakao", "en": "cocoa powder", "de": "Kakaopulver"},
    "cooking cream": {"hr": "vrhnje za kuhanje", "en": "cooking cream", "de": "Kochsahne"},
    "cornstarch": {"hr": "gustin", "en": "cornstarch", "de": "Speisestärke"},
    "cream": {"hr": "slatko vrhnje", "en": "whipping cream", "de": "Schlagsahne"},
    "cream cheese": {"hr": "krem sir", "en": "cream cheese", "de": "Frischkäse"},
    "processed cheese": {"hr": "topivi sir", "en": "processed cheese", "de": "Schmelzkäse"},
    "baking soda": {"hr": "soda bikarbona", "en": "baking soda", "de": "Natron"},
    "dried fruit": {"hr": "suho voće", "en": "dried fruit", "de": "Trockenfrüchte"},
    "dry ham": {"hr": "suha šunka", "en": "dry-cured ham", "de": "Rohschinken"},
    "egg": {"hr": "jaje", "en": "egg", "de": "Ei"},
    "egg white": {"hr": "bjelanjak", "en": "egg white", "de": "Eiweiß"},
    "egg yolk": {"hr": "žutanjak", "en": "egg yolk", "de": "Eigelb"},
    "emmental": {"hr": "ementaler", "en": "emmental", "de": "Emmentaler"},
    "flour": {"hr": "brašno", "en": "flour", "de": "Mehl"},
    "garlic": {"hr": "češnjak", "en": "garlic", "de": "Knoblauch"},
    "graham crumbs": {"hr": "krušne mrvice", "en": "breadcrumbs", "de": "Semmelbrösel"},
    "ground meat": {"hr": "mljeveno meso", "en": "ground meat", "de": "Hackfleisch"},
    "ham": {"hr": "šunka", "en": "ham", "de": "Schinken"},
    "honey": {"hr": "med", "en": "honey", "de": "Honig"},
    "hot pepper": {"hr": "ljuta paprika", "en": "hot pepper", "de": "scharfe Paprika"},
    "jam": {"hr": "pekmez", "en": "jam", "de": "Marmelade"},
    "jaffa biscuits": {"hr": "jaffa keks", "en": "jaffa biscuits", "de": "Jaffa-Kekse"},
    "ladyfingers": {"hr": "piškote", "en": "ladyfingers", "de": "Löffelbiskuits"},
    "lemon": {"hr": "limun", "en": "lemon", "de": "Zitrone"},
    "lemon salt": {"hr": "limuntus", "en": "citric acid", "de": "Zitronensäure"},
    "mandarin": {"hr": "mandarina", "en": "mandarin", "de": "Mandarine"},
    "margarine": {"hr": "margarin", "en": "margarine", "de": "Margarine"},
    "mascarpone": {"hr": "mascarpone", "en": "mascarpone", "de": "Mascarpone"},
    "milk": {"hr": "mlijeko", "en": "milk", "de": "Milch"},
    "minced biscuits": {"hr": "mljeveni keksi", "en": "ground biscuits", "de": "gemahlene Kekse"},
    "mushroom": {"hr": "šampinjoni", "en": "mushrooms", "de": "Champignons"},
    "oil": {"hr": "ulje", "en": "oil", "de": "Öl"},
    "onion": {"hr": "luk", "en": "onion", "de": "Zwiebel"},
    "orange": {"hr": "naranča", "en": "orange", "de": "Orange"},
    "oregano": {"hr": "origano", "en": "oregano", "de": "Oregano"},
    "paprika": {"hr": "paprika", "en": "paprika", "de": "Paprika"},
    "parsley": {"hr": "peršin", "en": "parsley", "de": "Petersilie"},
    "pasta": {"hr": "tjestenina", "en": "pasta", "de": "Pasta"},
    "pancetta": {"hr": "panceta", "en": "pancetta", "de": "Pancetta"},
    "pepper": {"hr": "papar", "en": "pepper", "de": "Pfeffer"},
    "peas": {"hr": "grašak", "en": "peas", "de": "Erbsen"},
    "pistachios": {"hr": "pistacije", "en": "pistachios", "de": "Pistazien"},
    "raisins": {"hr": "grožđice", "en": "raisins", "de": "Rosinen"},
    "pork": {"hr": "svinjetina", "en": "pork", "de": "Schweinefleisch"},
    "potato": {"hr": "krumpir", "en": "potato", "de": "Kartoffel"},
    "powdered sugar": {"hr": "šećer u prahu", "en": "powdered sugar", "de": "Puderzucker"},
    "poppy seeds": {"hr": "mak", "en": "poppy seeds", "de": "Mohn"},
    "prosciutto": {"hr": "pršut", "en": "prosciutto", "de": "Prosciutto"},
    "pudding powder": {"hr": "puding od vanilije", "en": "vanilla pudding powder", "de": "Vanillepuddingpulver"},
    "red pepper": {"hr": "crvena paprika", "en": "red pepper", "de": "rote Paprika"},
    "rice": {"hr": "riža", "en": "rice", "de": "Reis"},
    "raspberry": {"hr": "malina", "en": "raspberry", "de": "Himbeere"},
    "rum": {"hr": "rum", "en": "rum", "de": "Rum"},
    "salt": {"hr": "sol", "en": "salt", "de": "Salz"},
    "sour cream": {"hr": "kiselo vrhnje", "en": "sour cream", "de": "saure Sahne"},
    "spinach": {"hr": "špinat", "en": "spinach", "de": "Spinat"},
    "strawberry": {"hr": "jagoda", "en": "strawberry", "de": "Erdbeere"},
    "sugar": {"hr": "šećer", "en": "sugar", "de": "Zucker"},
    "sunflower oil": {"hr": "suncokretovo ulje", "en": "sunflower oil", "de": "Sonnenblumenöl"},
    "turkey ham": {"hr": "pureća šunka", "en": "turkey ham", "de": "Putenschinken"},
    "vanilla sugar": {"hr": "vanilin šećer", "en": "vanilla sugar", "de": "Vanillezucker"},
    "walnuts": {"hr": "orasi", "en": "walnuts", "de": "Walnüsse"},
    "water": {"hr": "voda", "en": "water", "de": "Wasser"},
    "white chocolate": {"hr": "bijela čokolada", "en": "white chocolate", "de": "weiße Schokolade"},
    "yeast": {"hr": "kvasac", "en": "yeast", "de": "Hefe"},
    "yogurt": {"hr": "jogurt", "en": "yogurt", "de": "Joghurt"},
    "zucchini": {"hr": "tikvica", "en": "zucchini", "de": "Zucchini"},
}

INGREDIENT_ALIASES = {
    "badem": "almonds",
    "bjelanj": "egg white",
    "brašna": "flour",
    "brašno": "flour",
    "bijele čokolade": "white chocolate",
    "bijela čokolada": "white chocolate",
    "bjelanjka": "egg white",
    "bjelanjaka": "egg white",
    "bjelanjke": "egg white",
    "celer": "celery root",
    "crvene paprike": "red pepper",
    "crne kave": "coffee",
    "cimeta": "cinnamon",
    "čokolade": "chocolate",
    "čokolade za kuhanje": "chocolate",
    "čokolada": "chocolate",
    "domaćeg karamela": "caramel",
    "grožđica": "raisins",
    "grožđice": "raisins",
    "jake crne kave": "coffee",
    "jogurta": "yogurt",
    "jogurt": "yogurt",
    "jogurti": "yogurt",
    "gorgonzole": "cheese",
    "graška": "peas",
    "gustin": "cornstarch",
    "kakaa": "cocoa powder",
    "kakao": "cocoa powder",
    "kakao u prahu": "cocoa powder",
    "kave": "coffee",
    "karamela": "caramel",
    "kokosa": "coconut",
    "kokos": "coconut",
    "krem sira": "cream cheese",
    "krem sir": "cream cheese",
    "jaffa keksa": "jaffa biscuits",
    "jaffa keks": "jaffa biscuits",
    "jagoda": "strawberry",
    "jaja": "egg",
    "jaje": "egg",
    "jetrica": "chicken liver",
    "keksa": "biscuits",
    "keksi": "biscuits",
    "kiselog vrhnja": "sour cream",
    "kiselo vrhnje": "sour cream",
    "korijena od celera": "celery root",
    "korijena od peršina": "parsley",
    "krušnih mrvica": "graham crumbs",
    "kvasca": "yeast",
    "kvasac": "yeast",
    "limun veći": "lemon",
    "limunova soka": "lemon",
    "limuna": "lemon",
    "limun": "lemon",
    "limuntusa": "lemon salt",
    "lovora": "bay leaf",
    "luka": "onion",
    "luk": "onion",
    "mandarine": "mandarin",
    "margarina": "margarine",
    "margarin": "margarine",
    "mascarpone sira": "mascarpone",
    "mascarpone": "mascarpone",
    "makarona": "pasta",
    "maka": "poppy seeds",
    "malina": "raspberry",
    "maslaca": "butter",
    "maslac": "butter",
    "putra": "butter",
    "meda": "honey",
    "med": "honey",
    "mesa": "ground meat",
    "meso": "ground meat",
    "mlijeka": "milk",
    "mlijeko": "milk",
    "mljevenih badema": "almonds",
    "mljevenih keksa": "minced biscuits",
    "mljevenog maka": "poppy seeds",
    "mljevenih oraha": "walnuts",
    "mljeveno meso": "ground meat",
    "malo ruma": "rum",
    "naranče": "orange",
    "naranča": "orange",
    "naribane kore mandarine": "mandarin",
    "naribana korica limuna": "lemon",
    "oraha": "walnuts",
    "papra": "pepper",
    "paprika": "paprika",
    "paprike": "paprika",
    "pancete": "pancetta",
    "pekmeza": "jam",
    "pekan oraha": "walnuts",
    "peršina": "parsley",
    "piškota": "ladyfingers",
    "piškote": "ladyfingers",
    "pileća": "chicken",
    "piletine": "chicken",
    "piletina": "chicken",
    "pistacija": "pistachios",
    "pistacije": "pistachios",
    "oljuštenih pistacija": "pistachios",
    "praška za pecivo": "baking powder",
    "pršuta": "prosciutto",
    "pudinga od vanilije": "pudding powder",
    "pureće šunke": "turkey ham",
    "riže": "rice",
    "ruma": "rum",
    "sira": "cheese",
    "sir": "cheese",
    "sira mascarpone": "mascarpone",
    "sode bikarbone": "baking soda",
    "slatke paprike": "paprika",
    "slatkog vrhnja": "cream",
    "slatko vrhnje": "cream",
    "kisela vrhnja": "sour cream",
    "soli": "salt",
    "sol": "salt",
    "soka od mandarine": "mandarin",
    "suhog voća": "dried fruit",
    "suho voće": "dried fruit",
    "soka od naranče": "orange",
    "sviježeg sira": "cheese",
    "svježeg sira": "cheese",
    "svježi sir": "cheese",
    "suncokretovog ulja": "sunflower oil",
    "suhe šunke": "dry ham",
    "sviježeg kvasca": "yeast",
    "šampinjona": "mushroom",
    "šampinjoni": "mushroom",
    "šećera": "sugar",
    "šećer": "sugar",
    "šlag": "cream",
    "šunke": "ham",
    "tekućeg jogurta": "yogurt",
    "tikvica": "zucchini",
    "tjestenine": "pasta",
    "tjestenina": "pasta",
    "topivog sira": "processed cheese",
    "ulja": "oil",
    "ulje": "oil",
    "vanilin šećer": "vanilla sugar",
    "vode": "water",
    "voda": "water",
    "vrhnje za kuhanje": "cooking cream",
    "vrhnja za šlag": "cream",
    "žlice sode bikarbone": "baking soda",
    "žumanjaka": "egg yolk",
    "žumanjka": "egg yolk",
    "žumanjak": "egg yolk",
    "žutanjka": "egg yolk",
}


@dataclass(frozen=True)
class RecipeSeed:
    source_file: str
    source_title: str
    recipe_title_hr: str
    category_slug: str
    tag_slugs: tuple[str, ...]
    title_translations: dict[str, str]
    servings: Decimal | None
    complexity: int | None


SELECTED_RECIPES = [
    RecipeSeed(
        source_file="Recepti - pregledati obavezno.doc",
        source_title="BRZO I FINO KIFLICE",
        recipe_title_hr="Brzo i fino kiflice",
        category_slug="baking",
        tag_slugs=("yeast-dough", "oven-baked"),
        title_translations={"en": "Quick Savory Crescent Rolls", "de": "Schnelle herzhafte Kipferl"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - pregledati obavezno.doc",
        source_title="CANTUCCI",
        recipe_title_hr="Cantucci",
        category_slug="desserts",
        tag_slugs=("cookies", "fruit"),
        title_translations={"en": "Cantucci Almond Biscuits", "de": "Cantucci Mandelgebäck"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - pregledati obavezno.doc",
        source_title="CLAFOUTIES S VIŠNJAMA",
        recipe_title_hr="Clafouties s višnjama",
        category_slug="desserts",
        tag_slugs=("cake", "fruit"),
        title_translations={"en": "Cherry Clafoutis", "de": "Clafoutis mit Sauerkirschen"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - pregledati obavezno.doc",
        source_title="DOMAĆE PIROŠKE",
        recipe_title_hr="Domaće piroške",
        category_slug="baking",
        tag_slugs=("traditional",),
        title_translations={"en": "Homemade Fried Piroshki", "de": "Hausgemachte Piroggen"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - DESERTI - 1 dio.doc",
        source_title="JAFFA TORTA",
        recipe_title_hr="Jaffa torta",
        category_slug="desserts",
        tag_slugs=("torte", "fruit"),
        title_translations={"en": "Jaffa Torte", "de": "Jaffa-Torte"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - DESERTI - 1 dio.doc",
        source_title="CRNI KOLAČ SA VIŠNJAMA",
        recipe_title_hr="Crni kolač sa višnjama",
        category_slug="desserts",
        tag_slugs=("cake", "fruit"),
        title_translations={"en": "Dark Chocolate Cherry Cake", "de": "Dunkler Schokoladenkuchen mit Kirschen"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - DESERTI - 2 dio.doc",
        source_title="ŠTRUDLA – SLOVENSKA POTICA",
        recipe_title_hr="Štrudla – slovenska potica",
        category_slug="desserts",
        tag_slugs=("yeast-dough", "torte"),
        title_translations={"en": "Slovenian Potica Roll", "de": "Slowenische Potica"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - GLAVNA JELA - 1 dio (2).docx",
        source_title="PUNJENA MESNA ŠTRUCA",
        recipe_title_hr="Punjena mesna štruca",
        category_slug="main-dishes",
        tag_slugs=("meat", "oven-baked"),
        title_translations={"en": "Stuffed Meatloaf", "de": "Gefüllter Hackbraten"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - GLAVNA JELA - 1 dio (2).docx",
        source_title="ZIMNICA – SIRUP OD LIMUNA",
        recipe_title_hr="Sirup od limuna",
        category_slug="drinks",
        tag_slugs=("citrus", "preserve"),
        title_translations={"en": "Lemon Syrup", "de": "Zitronensirup"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - GLAVNA JELA - 1 dio (2).docx",
        source_title="MAKARONE S ŠAMPINJONIMA I MLJEVENIM MESOM",
        recipe_title_hr="Makarone sa šampinjonima i mljevenim mesom",
        category_slug="main-dishes",
        tag_slugs=("pasta", "meat", "oven-baked"),
        title_translations={"en": "Baked Pasta with Mushrooms and Ground Meat", "de": "Überbackene Nudeln mit Champignons und Hackfleisch"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - GLAVNA JELA - 2 dio (2).docx",
        source_title="CARBONARA – Kremasta Karbonara pasta",
        recipe_title_hr="Carbonara – kremasta karbonara pasta",
        category_slug="main-dishes",
        tag_slugs=("pasta", "meat"),
        title_translations={"en": "Creamy Carbonara Pasta", "de": "Cremige Carbonara-Pasta"},
        servings=None,
        complexity=None,
    ),
    RecipeSeed(
        source_file="Recepti - GLAVNA JELA - 2 dio (2).docx",
        source_title="ŠURLICE U TAVI",
        recipe_title_hr="Šurlice u tavi",
        category_slug="main-dishes",
        tag_slugs=("pasta", "meat"),
        title_translations={"en": "Pan-Fried Šurlice", "de": "Šurlice aus der Pfanne"},
        servings=None,
        complexity=None,
    ),
]


def normalize_key(value: str) -> str:
    return slugify(value or "", separator="-", lowercase=True)


def clean_text(value: str) -> str:
    value = value.replace("\r", "\n").replace("\f", "\n")
    value = CONTROL_RE.sub("", value)
    value = value.replace("\u00a0", " ")
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def looks_like_title(value: str) -> bool:
    raw = value.strip().strip(":")
    if not raw or len(raw) < 4 or len(raw) > 120:
        return False
    if raw[0].isdigit() or raw[0] in FRACTIONS:
        return False
    if raw.startswith(("●", "-", "•", "⦁")):
        return False
    if normalize_key(raw) in TITLE_STOPWORDS:
        return False
    if any(token in raw.lower() for token in ("sastojci", "priprema", "postupak", "napomena", "savjet")):
        return False
    letters = [char for char in raw if char.isalpha()]
    if not letters:
        return False
    uppercase_ratio = sum(1 for char in letters if char.isupper()) / len(letters)
    return uppercase_ratio > 0.6 or " – " in raw or ("-" in raw and len(raw.split()) <= 8)


def is_ingredient_heading(value: str) -> bool:
    lowered = value.lower()
    return lowered.startswith(("potrebni sastojci", "sastojci", "potrebno", "još sastojaka", "za noklice"))


def is_step_heading(value: str) -> bool:
    lowered = value.lower()
    return lowered.startswith(("priprema", "postupak izrade", "način pripreme", "izrada", "slaganje torte"))


def looks_like_ingredient_line(value: str) -> bool:
    stripped = value.strip("•●⦁- ")
    if not stripped:
        return False
    if stripped.endswith(":"):
        return True
    return bool(re.match(r"^[\d¼½¾⅓⅔.,/-]+\s*[A-Za-zčćžšđČĆŽŠĐ.]*\s+.+$", stripped))


def doc_text(path: Path) -> str:
    ole = olefile.OleFileIO(path)
    word_document = ole.openstream("WordDocument").read()
    flags = struct.unpack_from("<H", word_document, 0x0A)[0]
    table_name = "1Table" if ((flags >> 9) & 1) else "0Table"
    table_stream = ole.openstream(table_name).read()
    fc_clx, lcb_clx = struct.unpack_from("<II", word_document, 0x1A2)
    clx = table_stream[fc_clx : fc_clx + lcb_clx]
    offset = 0
    while clx[offset] == 1:
        grpprl_len = struct.unpack_from("<H", clx, offset + 1)[0]
        offset += 3 + grpprl_len
    piece_len = struct.unpack_from("<I", clx, offset + 1)[0]
    piece_table = clx[offset + 5 : offset + 5 + piece_len]
    piece_count = (piece_len - 4) // 12
    cps = [struct.unpack_from("<I", piece_table, index * 4)[0] for index in range(piece_count + 1)]
    chunks: list[str] = []
    for index in range(piece_count):
        pcd_offset = (piece_count + 1) * 4 + index * 8
        fc_value = struct.unpack_from("<I", piece_table, pcd_offset + 2)[0]
        compressed = bool(fc_value & 0x40000000)
        file_offset = fc_value & 0x3FFFFFFF
        char_count = cps[index + 1] - cps[index]
        if compressed:
            file_offset //= 2
            raw = word_document[file_offset : file_offset + char_count]
            chunks.append(raw.decode("cp1250", "ignore"))
        else:
            raw = word_document[file_offset : file_offset + char_count * 2]
            chunks.append(raw.decode("utf-16le", "ignore"))
    return clean_text("".join(chunks))


def docx_items(path: Path) -> list[dict[str, Any]]:
    with zipfile.ZipFile(path) as archive:
        document_xml = ET.fromstring(archive.read("word/document.xml"))
        rels_xml = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
        rel_map = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels_xml
            if rel.tag.endswith("Relationship")
        }
        ns = {
            "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
            "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        }
        body = document_xml.find("w:body", ns)
        items: list[dict[str, Any]] = []
        if body is None:
            return items
        for child in body:
            if not child.tag.endswith("p"):
                continue
            text = " ".join(part.text for part in child.findall(".//w:t", ns) if part.text)
            text = clean_text(text)
            if text:
                items.append({"type": "text", "value": text})
            for blip in child.findall(".//a:blip", ns):
                rel_id = blip.attrib.get(f"{{{ns['r']}}}embed")
                target = rel_map.get(rel_id or "")
                if not target:
                    continue
                item_path = f"word/{target}".replace("\\", "/")
                items.append(
                    {
                        "type": "image",
                        "value": archive.read(item_path),
                        "name": Path(target).name,
                    }
                )
        return items


def doc_items(path: Path) -> list[dict[str, Any]]:
    return [{"type": "text", "value": line} for line in doc_text(path).splitlines() if line.strip()]


def parse_blocks(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    blocks: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(items):
        if item["type"] != "text":
            continue
        title = item["value"].strip()
        if not looks_like_title(title):
            continue
        ingredient_idx = None
        has_ingredient_heading = False
        for probe in range(index + 1, min(index + 11, len(items))):
            if items[probe]["type"] == "text" and is_ingredient_heading(items[probe]["value"]):
                ingredient_idx = probe
                has_ingredient_heading = True
                break
        if ingredient_idx is None:
            first_ingredient_probe = None
            for probe in range(index + 1, min(index + 6, len(items))):
                if items[probe]["type"] == "text" and looks_like_ingredient_line(items[probe]["value"]):
                    first_ingredient_probe = probe
                    break
            if first_ingredient_probe is None:
                continue
            ingredient_idx = first_ingredient_probe - 1
        end_idx = len(items)
        for probe in range(ingredient_idx + 1, len(items)):
            probe_item = items[probe]
            if probe_item["type"] == "text" and looks_like_title(probe_item["value"]):
                future_has_ingredients = any(
                    items[lookahead]["type"] == "text" and is_ingredient_heading(items[lookahead]["value"])
                    for lookahead in range(probe + 1, min(probe + 10, len(items)))
                )
                if future_has_ingredients:
                    end_idx = probe
                    break
        step_idx = None
        for probe in range(ingredient_idx + 1, min(ingredient_idx + 80, end_idx)):
            if items[probe]["type"] == "text" and is_step_heading(items[probe]["value"]):
                step_idx = probe
                break
        if step_idx is None:
            for probe in range(ingredient_idx + 1, end_idx):
                probe_item = items[probe]
                if probe_item["type"] != "text":
                    continue
                probe_text = probe_item["value"]
                if probe_text and not looks_like_ingredient_line(probe_text):
                    step_idx = probe
                    break
        if step_idx is None:
            continue
        author_lines = [
            items[current]["value"]
            for current in range(index + 1, ingredient_idx)
            if items[current]["type"] == "text"
        ]
        ingredient_lines = [
            items[current]["value"]
            for current in range(ingredient_idx + 1, step_idx if not has_ingredient_heading else step_idx)
            if items[current]["type"] == "text"
        ]
        step_lines = [
            items[current]["value"]
            for current in range((step_idx + 1) if has_ingredient_heading and is_step_heading(items[step_idx]["value"]) else step_idx, end_idx)
            if items[current]["type"] == "text"
        ]
        image_bytes = [
            items[current]["value"]
            for current in range(index, end_idx)
            if items[current]["type"] == "image"
        ]
        image_urls = IMAGE_URL_RE.findall("\n".join(step_lines + ingredient_lines + author_lines))
        blocks[normalize_key(title)] = {
            "title": title,
            "author": " | ".join(author_lines[:3]),
            "ingredients": ingredient_lines,
            "steps": step_lines,
            "image_bytes": image_bytes,
            "image_urls": image_urls,
        }
    return blocks


def normalize_fraction(value: str) -> Decimal | None:
    value = value.strip()
    if not value:
        return None
    if value in FRACTIONS:
        return FRACTIONS[value]
    if "-" in value:
        first_part = value.split("-", 1)[0]
        return normalize_fraction(first_part)
    if "/" in value and value.count("/") == 1:
        numerator, denominator = value.split("/", 1)
        if numerator.isdigit() and denominator.isdigit() and denominator != "0":
            return Decimal(numerator) / Decimal(denominator)
    value = value.replace(",", ".")
    try:
        return Decimal(value)
    except Exception:
        return None


def parse_ingredient_line(line: str, current_group: str | None) -> dict[str, Any] | None:
    text = line.strip("•●⦁- ")
    if not text:
        return None
    if text.endswith(":"):
        return {"group": text.rstrip(":")}
    match = re.match(
        r"^(?P<amount>[\d¼½¾⅓⅔.,/-]+)?\s*(?P<unit>[A-Za-zčćžšđČĆŽŠĐ.]+)?\s*(?P<name>.+)$",
        text,
    )
    if not match:
        return None
    amount = normalize_fraction(match.group("amount") or "")
    unit_raw = (match.group("unit") or "").lower().rstrip(".")
    unit_scale = UNIT_SCALES.get(unit_raw, Decimal("1"))
    unit = UNIT_ALIASES.get(unit_raw)
    if amount is None and unit is not None:
        name = text
        unit = None
    else:
        name = match.group("name").strip()
    if amount is not None and unit in {"g", "ml"}:
        amount *= unit_scale
    note_parts = []
    if current_group:
        note_parts.append(current_group)
    parenthetical = re.findall(r"\(([^)]+)\)", name)
    if parenthetical:
        note_parts.extend(parenthetical)
    name = re.sub(r"\([^)]*\)", "", name).strip(" ,.;")
    canonical_key = canonical_ingredient_key(name)
    note = " | ".join(part.strip() for part in note_parts if part.strip()) or None
    return {
        "amount": amount,
        "unit": unit,
        "ingredient_key": canonical_key,
        "name": name,
        "note": note,
    }


def canonical_ingredient_key(name: str) -> str:
    lowered = name.lower()
    for alias, key in sorted(INGREDIENT_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
        pattern = rf"(^|[^a-zčćžšđ]){re.escape(alias)}([^a-zčćžšđ]|$)"
        if re.search(pattern, lowered):
            return key
    return normalize_key(name) or "misc"


def recipe_steps_html(lines: list[str]) -> str:
    html_parts: list[str] = []
    ordered_items: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.upper() == line and len(line) < 6:
            continue
        line = line.replace("\u0007", " ")
        line = re.sub(r"\s+", " ", line)
        image_free = IMAGE_URL_RE.sub("", line).strip()
        if not image_free:
            continue
        if STEP_PREFIX_RE.match(image_free):
            ordered_items.append(STEP_PREFIX_RE.sub("", image_free).strip())
            continue
        if ordered_items:
            ordered_items[-1] = f"{ordered_items[-1]} {image_free}".strip()
            continue
        if ordered_items:
            html_parts.append("<ol>" + "".join(f"<li>{item}</li>" for item in ordered_items) + "</ol>")
            ordered_items = []
        html_parts.append(f"<p>{image_free}</p>")
    if ordered_items:
        html_parts.append("<ol>" + "".join(f"<li>{item}</li>" for item in ordered_items) + "</ol>")
    return "\n".join(html_parts)


def choose_image(block: dict[str, Any]) -> bytes | None:
    if block["image_bytes"]:
        return block["image_bytes"][0]
    if not block["image_urls"]:
        return None
    preferred = sorted(
        set(block["image_urls"]),
        key=lambda url: ("300x" in url or "150x" in url, len(url)),
    )
    for url in preferred:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "LetsCook seed importer"})
            with urllib.request.urlopen(request, timeout=30, context=ssl._create_unverified_context()) as response:
                return response.read()
        except Exception:
            continue
    return None


def ensure_media_file(image_bytes: bytes, source_name: str) -> dict[str, Any] | None:
    try:
        image = Image.open(BytesIO(image_bytes))
        width, height = image.size
        image_format = (image.format or "jpeg").lower()
        extension = "jpg" if image_format == "jpeg" else image_format
        checksum = hashlib.sha256(image_bytes).hexdigest()
        filename = f"{checksum[:24]}-{slugify(Path(source_name).stem)}.{extension}"
        MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        file_path = MEDIA_ROOT / filename
        file_path.write_bytes(image_bytes)
        mime = Image.MIME.get(image.format or "JPEG", "image/jpeg")
        return {
            "filename": filename,
            "width": width,
            "height": height,
            "mime": mime,
            "size": len(image_bytes),
            "checksum": checksum,
            "storage_path": str(file_path.relative_to(ROOT)).replace("\\", "/"),
        }
    except Exception:
        return None


def ensure_schema(conn: psycopg.Connection[Any]) -> None:
    with conn.cursor() as cursor:
        cursor.execute("select to_regclass('public.users')")
        has_users = cursor.fetchone()[0] is not None
        if not has_users:
            cursor.execute(SCHEMA_FILE.read_text(encoding="utf-8"))
        cursor.execute(
            """
            create table if not exists category_translations (
                id bigserial primary key,
                category_id bigint not null references categories(id) on delete cascade,
                language char(2) not null,
                name text not null,
                unique (category_id, language)
            );
            create table if not exists tag_translations (
                id bigserial primary key,
                tag_id bigint not null references tags(id) on delete cascade,
                language char(2) not null,
                name text not null,
                unique (tag_id, language)
            );
            create table if not exists recipe_translations (
                id bigserial primary key,
                recipe_id bigint not null references recipes(id) on delete cascade,
                language char(2) not null,
                title text not null,
                unique (recipe_id, language)
            );
            """
        )


def action_id_map(conn: psycopg.Connection[Any]) -> dict[str, int]:
    with conn.cursor() as cursor:
        cursor.execute("select code, id from actions where code = any(%s)", (DEFAULT_ACTION_CODES,))
        return dict(cursor.fetchall())


def upsert_user(conn: psycopg.Connection[Any], *, user_id: int | None, email: str, display_name: str, password: str, role: str) -> int:
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with conn.cursor() as cursor:
        if user_id is not None:
            cursor.execute(
                """
                insert into users (id, email, display_name, password_hash, role, email_verified_at)
                values (%s, %s, %s, %s, %s, now())
                on conflict (id) do update
                set email = excluded.email,
                    display_name = excluded.display_name,
                    password_hash = excluded.password_hash,
                    role = excluded.role,
                    email_verified_at = coalesce(users.email_verified_at, excluded.email_verified_at),
                    updated_at = now()
                returning id
                """,
                (user_id, email, display_name, password_hash, role),
            )
        else:
            cursor.execute(
                """
                insert into users (email, display_name, password_hash, role, email_verified_at)
                values (%s, %s, %s, %s, now())
                on conflict (email) do update
                set display_name = excluded.display_name,
                    password_hash = excluded.password_hash,
                    role = excluded.role,
                    email_verified_at = coalesce(users.email_verified_at, excluded.email_verified_at),
                    updated_at = now()
                returning id
                """,
                (email, display_name, password_hash, role),
            )
        return int(cursor.fetchone()[0])


def insert_action_log(conn: psycopg.Connection[Any], action_id: int, actor_user_id: int | None, target_user_id: int | None, extra: dict[str, Any]) -> int:
    with conn.cursor() as cursor:
        cursor.execute(
            """
            insert into action_log (action_id, actor_user_id, target_user_id, extra)
            values (%s, %s, %s, %s::jsonb)
            returning id
            """,
            (action_id, actor_user_id, target_user_id, json.dumps(extra, ensure_ascii=False)),
        )
        return int(cursor.fetchone()[0])


def upsert_category(conn: psycopg.Connection[Any], slug: str, translations: dict[str, str]) -> int:
    with conn.cursor() as cursor:
        cursor.execute(
            """
            insert into categories (slug, name, language)
            values (%s, %s, 'hr')
            on conflict (slug) do update set name = excluded.name
            returning id
            """,
            (slug, translations["hr"]),
        )
        category_id = int(cursor.fetchone()[0])
        for language, name in translations.items():
            cursor.execute(
                """
                insert into category_translations (category_id, language, name)
                values (%s, %s, %s)
                on conflict (category_id, language) do update set name = excluded.name
                """,
                (category_id, language, name),
            )
        return category_id


def upsert_tag(conn: psycopg.Connection[Any], slug: str, translations: dict[str, str]) -> int:
    with conn.cursor() as cursor:
        cursor.execute(
            """
            insert into tags (slug, name, language)
            values (%s, %s, 'hr')
            on conflict (slug) do update set name = excluded.name
            returning id
            """,
            (slug, translations["hr"]),
        )
        tag_id = int(cursor.fetchone()[0])
        for language, name in translations.items():
            cursor.execute(
                """
                insert into tag_translations (tag_id, language, name)
                values (%s, %s, %s)
                on conflict (tag_id, language) do update set name = excluded.name
                """,
                (tag_id, language, name),
            )
        return tag_id


def upsert_ingredient(conn: psycopg.Connection[Any], ingredient_key: str, created_by: int) -> int:
    translations = INGREDIENT_TRANSLATIONS.get(ingredient_key)
    canonical_name = translations["hr"] if translations else ingredient_key.replace("-", " ")
    with conn.cursor() as cursor:
        cursor.execute(
            """
            insert into ingredients (canonical_name, created_by)
            values (%s, %s)
            on conflict (canonical_name) do update set created_by = coalesce(ingredients.created_by, excluded.created_by)
            returning id
            """,
            (canonical_name, created_by),
        )
        ingredient_id = int(cursor.fetchone()[0])
        if translations:
            for language in LANGUAGES:
                cursor.execute(
                    """
                    insert into ingredient_translations (ingredient_id, language, name)
                    values (%s, %s, %s)
                    on conflict (ingredient_id, language) do update set name = excluded.name
                    """,
                    (ingredient_id, language, translations[language]),
                )
        return ingredient_id


def prepare_recipes() -> list[dict[str, Any]]:
    source_cache: dict[str, dict[str, dict[str, Any]]] = {}
    prepared: list[dict[str, Any]] = []
    for recipe_seed in SELECTED_RECIPES:
        if recipe_seed.source_file not in source_cache:
            source_path = INPUT_DOC / recipe_seed.source_file
            items = docx_items(source_path) if source_path.suffix.lower() == ".docx" else doc_items(source_path)
            source_cache[recipe_seed.source_file] = parse_blocks(items)
        block = source_cache[recipe_seed.source_file].get(normalize_key(recipe_seed.source_title))
        if block is None:
            raise RuntimeError(f"Recipe not found in source: {recipe_seed.source_file} :: {recipe_seed.source_title}")
        ingredient_rows: list[dict[str, Any]] = []
        current_group = None
        for raw_line in block["ingredients"]:
            parsed = parse_ingredient_line(raw_line, current_group)
            if not parsed:
                continue
            if "group" in parsed:
                current_group = parsed["group"]
                continue
            ingredient_rows.append(parsed)
        prepared.append(
            {
                "seed": recipe_seed,
                "block": block,
                "ingredient_rows": ingredient_rows,
                "steps_html": recipe_steps_html(block["steps"]),
                "image_bytes": choose_image(block),
            }
        )
    return prepared


def insert_media(conn: psycopg.Connection[Any], owner_id: int, recipe_id: int, source_name: str, image_bytes: bytes, actions: dict[str, int]) -> int | None:
    file_meta = ensure_media_file(image_bytes, source_name)
    if file_meta is None:
        return None
    with conn.cursor() as cursor:
        cursor.execute(
            """
            insert into media (
                owner_id, recipe_id, original_filename, stored_filename, mime_type, byte_size,
                width, height, storage_path, variants, checksum_sha256, scan_status
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, '{}'::jsonb, %s, 'clean')
            returning id
            """,
            (
                owner_id,
                recipe_id,
                source_name,
                file_meta["filename"],
                file_meta["mime"],
                file_meta["size"],
                file_meta["width"],
                file_meta["height"],
                file_meta["storage_path"],
                file_meta["checksum"],
            ),
        )
        media_id = int(cursor.fetchone()[0])
    insert_action_log(
        conn,
        actions["media.uploaded"],
        owner_id,
        owner_id,
        {"table": "media", "record_id": media_id, "storage_path": file_meta["storage_path"]},
    )
    return media_id


def main() -> None:
    env = dotenv_values(ENV_FILE)
    database_url = os.environ.get("DATABASE_URL") or env.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError(f"DATABASE_URL is missing in {ENV_FILE}")
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    recipes = prepare_recipes()
    with psycopg.connect(database_url) as conn:
        ensure_schema(conn)
        actions = action_id_map(conn)

        superadmin_id = upsert_user(
            conn,
            user_id=1,
            email=os.environ.get("SEED_SUPERADMIN_EMAIL") or env.get("SEED_SUPERADMIN_EMAIL", "superadmin@letscook.local"),
            display_name="LetsCook SuperAdmin",
            password=os.environ.get("SEED_SUPERADMIN_PASSWORD") or env.get("SEED_SUPERADMIN_PASSWORD", "LetsCook-SuperAdmin-2026!"),
            role="superadmin",
        )
        durdica_id = upsert_user(
            conn,
            user_id=None,
            email="durdica.vukelic@gmail.com",
            display_name="Đurđica Vukelić",
            password="Alen1981",
            role="user",
        )
        insert_action_log(conn, actions["auth.registered"], superadmin_id, superadmin_id, {"seed": True})
        insert_action_log(conn, actions["auth.registered"], superadmin_id, durdica_id, {"seed": True})

        category_ids = {slug: upsert_category(conn, slug, translations) for slug, translations in CATEGORIES.items()}
        tag_ids = {slug: upsert_tag(conn, slug, translations) for slug, translations in TAGS.items()}
        ingredient_ids: dict[str, int] = {}

        for recipe in recipes:
            seed = recipe["seed"]
            block = recipe["block"]
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    insert into recipes (
                        author_id, category_id, title, language, steps_html, prep_time_minutes, servings, author_complexity
                    )
                    values (%s, %s, %s, 'hr', %s, %s, %s, %s)
                    returning id
                    """,
                    (
                        durdica_id,
                        category_ids[seed.category_slug],
                        seed.recipe_title_hr,
                        recipe["steps_html"],
                        None,
                        None,
                        None,
                    ),
                )
                recipe_id = int(cursor.fetchone()[0])

                for language in ("hr", "en", "de"):
                    title = seed.recipe_title_hr if language == "hr" else seed.title_translations[language]
                    cursor.execute(
                        """
                        insert into recipe_translations (recipe_id, language, title)
                        values (%s, %s, %s)
                        on conflict (recipe_id, language) do update set title = excluded.title
                        """,
                        (recipe_id, language, title),
                    )

                for tag_slug in seed.tag_slugs:
                    cursor.execute(
                        "insert into recipe_tags (recipe_id, tag_id) values (%s, %s) on conflict do nothing",
                        (recipe_id, tag_ids[tag_slug]),
                    )

            for sort_order, ingredient_row in enumerate(recipe["ingredient_rows"], start=1):
                key = ingredient_row["ingredient_key"]
                ingredient_id = ingredient_ids.setdefault(key, upsert_ingredient(conn, key, durdica_id))
                amount = ingredient_row["amount"]
                unit = ingredient_row["unit"]
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into recipe_ingredients (recipe_id, ingredient_id, amount, unit, note, sort_order)
                        values (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            recipe_id,
                            ingredient_id,
                            amount,
                            unit,
                            ingredient_row["note"] or ingredient_row["name"],
                            sort_order,
                        ),
                    )

            media_id = None
            if recipe["image_bytes"]:
                media_id = insert_media(
                    conn,
                    owner_id=durdica_id,
                    recipe_id=recipe_id,
                    source_name=f"{seed.recipe_title_hr}.jpg",
                    image_bytes=recipe["image_bytes"],
                    actions=actions,
                )
            if media_id is not None:
                with conn.cursor() as cursor:
                    cursor.execute("update recipes set main_media_id = %s where id = %s", (media_id, recipe_id))

            insert_action_log(
                conn,
                actions["recipe.created"],
                durdica_id,
                durdica_id,
                {
                    "table": "recipes",
                    "record_id": recipe_id,
                    "source_file": seed.source_file,
                    "source_title": seed.source_title,
                    "imported_author": block["author"],
                },
            )

        conn.commit()
        print(f"Seeded {len(recipes)} recipes, users, translations, ingredients, media, and taxonomy.")


if __name__ == "__main__":
    main()
