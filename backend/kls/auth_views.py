from __future__ import annotations

from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from inventory.audit import log_audit_event
from inventory.models import AuditEvent


class LoggingTokenObtainPairView(TokenObtainPairView):
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = getattr(serializer, "user", None)
        username = (
            (getattr(user, "get_username", lambda: "")() if user is not None else "")
            or (getattr(user, "username", "") if user is not None else "")
            or ""
        )

        class _RequestWithUser:
            def __init__(self, req, user_obj):
                self.user = user_obj
                self.META = getattr(req, "META", {})
                self.path = getattr(req, "path", "")
                self.method = getattr(req, "method", "")

        log_audit_event(
            _RequestWithUser(request, user),
            action=AuditEvent.Action.LOGIN,
            entity="auth",
            message="Connexion",
            metadata={"username": username},
        )

        return Response(serializer.validated_data, status=200)
