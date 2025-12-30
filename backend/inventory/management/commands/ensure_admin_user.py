import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Ensures a default admin user exists (idempotent)."

    def handle(self, *args, **options):  # noqa: ARG002
        username = os.environ.get("DJANGO_SUPERUSER_USERNAME")
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL")
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD")
        update_password = os.environ.get("DJANGO_SUPERUSER_UPDATE_PASSWORD", "0").strip().lower() in {
            "1",
            "true",
            "yes",
            "y",
            "on",
        }

        if not username or not password:
            self.stdout.write(
                self.style.WARNING(
                    "DJANGO_SUPERUSER_USERNAME / DJANGO_SUPERUSER_PASSWORD not set; skipping.",
                )
            )
            return

        weak_passwords = {"change_me", "change-me", "admin_password", "password", "123456", "admin"}
        if password.strip().lower() in weak_passwords:
            self.stdout.write(
                self.style.WARNING(
                    "DJANGO_SUPERUSER_PASSWORD semble faible/placeholder. "
                    "Change-le avant un déploiement en production (Render)."
                )
            )

        User = get_user_model()
        user, created = User.objects.get_or_create(
            username=username,
            defaults={"email": email or ""},
        )
        if created:
            user.is_staff = True
            user.is_superuser = True
            user.set_password(password)
            user.save(update_fields=["is_staff", "is_superuser", "password", "email"])
            self.stdout.write(self.style.SUCCESS(f"Created admin user: {username}"))
            return

        if not user.is_superuser or not user.is_staff:
            user.is_staff = True
            user.is_superuser = True
            user.save(update_fields=["is_staff", "is_superuser"])

        if update_password and not user.check_password(password):
            user.set_password(password)
            user.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f"Updated admin password: {username}"))
        self.stdout.write(self.style.SUCCESS(f"Admin user already exists: {username}"))
