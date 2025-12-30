from __future__ import annotations

from typing import Any

from django.db import DatabaseError
from django.utils.encoding import force_str

from inventory.models import AuditEvent


def _get_client_ip(request) -> str:
    meta = getattr(request, "META", {}) or {}
    xff = meta.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return str(xff).split(",")[0].strip()
    return str(meta.get("REMOTE_ADDR") or "").strip()


def log_audit_event(
    request,
    *,
    action: str,
    entity: str = "",
    obj: Any | None = None,
    message: str = "",
    metadata: dict[str, Any] | None = None,
    envoi: Any | None = None,
) -> None:
    try:
        user = getattr(request, "user", None)
        username = ""
        user_fk = None
        if getattr(user, "is_authenticated", False):
            username = getattr(user, "get_username", lambda: "")() or getattr(user, "username", "") or ""
            user_fk = user

        object_id = ""
        object_repr = ""
        if obj is not None:
            object_id = str(getattr(obj, "pk", "") or "")
            object_repr = force_str(obj)[:200]

        envoi_id = None
        if envoi is not None:
            envoi_id = getattr(envoi, "pk", None) or getattr(envoi, "id", None) or envoi
        elif obj is not None:
            envoi_id = getattr(obj, "envoi_id", None)
            if envoi_id is None:
                produit = getattr(obj, "produit", None)
                envoi_id = getattr(produit, "envoi_id", None) if produit is not None else None

        AuditEvent.objects.create(
            user=user_fk,
            username=username,
            envoi_id=envoi_id,
            action=action,
            entity=entity,
            object_id=object_id,
            object_repr=object_repr,
            message=message or "",
            path=str(getattr(request, "path", "") or "")[:300],
            method=str(getattr(request, "method", "") or "")[:10],
            ip_address=_get_client_ip(request)[:64],
            metadata=metadata or {},
        )
    except DatabaseError:
        # Ne jamais bloquer l'API si l'audit log est en panne.
        return
    except Exception:  # noqa: BLE001
        return
