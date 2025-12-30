from __future__ import annotations

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0003_produit_image"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("username", models.CharField(blank=True, default="", max_length=150)),
                (
                    "action",
                    models.CharField(
                        choices=[
                            ("login", "Login"),
                            ("create", "Create"),
                            ("update", "Update"),
                            ("delete", "Delete"),
                            ("import", "Import"),
                            ("purge", "Purge"),
                        ],
                        max_length=20,
                    ),
                ),
                ("entity", models.CharField(blank=True, default="", max_length=50)),
                ("object_id", models.CharField(blank=True, default="", max_length=64)),
                ("object_repr", models.CharField(blank=True, default="", max_length=200)),
                ("message", models.TextField(blank=True, default="")),
                ("path", models.CharField(blank=True, default="", max_length=300)),
                ("method", models.CharField(blank=True, default="", max_length=10)),
                ("ip_address", models.CharField(blank=True, default="", max_length=64)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="audit_events",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
    ]

