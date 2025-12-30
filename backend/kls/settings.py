from __future__ import annotations

import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def _load_or_create_secret_key() -> str:
    env_value = os.environ.get("DJANGO_SECRET_KEY")
    if env_value and env_value.strip() and env_value.strip() not in {"change-me", "change_me"}:
        return env_value.strip()

    secret_file = BASE_DIR / ".django_secret_key"
    try:
        existing = secret_file.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        existing = ""

    if existing and existing not in {"change-me", "change_me"}:
        return existing

    secret = get_random_secret_key()
    try:
        secret_file.write_text(secret, encoding="utf-8")
    except Exception:  # noqa: BLE001
        return secret
    return secret


SECRET_KEY = _load_or_create_secret_key()
DEBUG = _env_bool("DJANGO_DEBUG", False)

allowed_hosts_raw = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
ALLOWED_HOSTS = [h.strip() for h in allowed_hosts_raw.split(",") if h.strip()]

csrf_trusted_origins_raw = os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "")
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in csrf_trusted_origins_raw.split(",")
    if origin.strip()
]

TIME_ZONE = os.environ.get("DJANGO_TIME_ZONE", "UTC")
LANGUAGE_CODE = "fr-fr"
USE_I18N = True
USE_TZ = True

USE_X_FORWARDED_HOST = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

USE_HTTPS = _env_bool("DJANGO_USE_HTTPS", False)
SECURE_SSL_REDIRECT = USE_HTTPS and not DEBUG
SESSION_COOKIE_SECURE = USE_HTTPS and not DEBUG
CSRF_COOKIE_SECURE = USE_HTTPS and not DEBUG
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"

SECURE_HSTS_SECONDS = 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
if USE_HTTPS and not DEBUG:
    # Active HSTS uniquement en mode "prod" (HTTPS + DEBUG=0).
    hsts_seconds_raw = os.environ.get("DJANGO_HSTS_SECONDS", "31536000")
    try:
        SECURE_HSTS_SECONDS = max(int(hsts_seconds_raw), 0)
    except ValueError:
        SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

max_upload_mb_raw = os.environ.get("DJANGO_MAX_UPLOAD_MB", "50")
try:
    MAX_UPLOAD_MB = max(int(max_upload_mb_raw), 1)
except ValueError:
    MAX_UPLOAD_MB = 50

DATA_UPLOAD_MAX_MEMORY_SIZE = MAX_UPLOAD_MB * 1024 * 1024
# Au-delà de ce seuil, Django écrit le fichier en temp sur disque (évite de garder un gros Excel en RAM).
FILE_UPLOAD_MAX_MEMORY_SIZE = min(DATA_UPLOAD_MAX_MEMORY_SIZE, 5 * 1024 * 1024)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "inventory.apps.InventoryConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "kls.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "kls.wsgi.application"

DATABASES = {
    "default": dj_database_url.config(
        default="postgresql://kls_user:change_me@postgres:5432/kls_db",
        conn_max_age=60,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    }
}

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
}

if not DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = ("rest_framework.renderers.JSONRenderer",)

SIMPLE_JWT = {
    # Refresh token rotation + blacklist: réduit l'impact d'un refresh token volé.
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

if not DEBUG:
    if SECRET_KEY in {"change-me", "change_me"} or len(SECRET_KEY) < 32:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY doit être défini (fort) en production, "
            "ou un fichier backend/.django_secret_key doit exister.",
        )
    if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
        raise ImproperlyConfigured(
            "DJANGO_ALLOWED_HOSTS doit être défini (sans '*') en production.",
        )
