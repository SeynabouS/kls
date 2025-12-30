from __future__ import annotations

from django.db import migrations, models
from django.utils import timezone
import django.db.models.deletion


def backfill_default_envoi(apps, schema_editor):  # noqa: ARG001
    from django.db.models import Max, Min
    from django.utils import timezone

    Envoi = apps.get_model("inventory", "Envoi")
    Produit = apps.get_model("inventory", "Produit")
    Transaction = apps.get_model("inventory", "Transaction")

    if not Produit.objects.filter(envoi__isnull=True).exists():
        return

    min_dt = Transaction.objects.aggregate(v=Min("date_transaction"))["v"]
    max_dt = Transaction.objects.aggregate(v=Max("date_transaction"))["v"]

    date_debut = min_dt.date() if min_dt else timezone.localdate()
    date_fin = max_dt.date() if max_dt else date_debut

    envoi, _created = Envoi.objects.get_or_create(
        nom="Envoi 1",
        defaults={"date_debut": date_debut, "date_fin": date_fin},
    )

    Produit.objects.filter(envoi__isnull=True).update(envoi=envoi)


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0004_audit_event"),
    ]

    operations = [
        migrations.CreateModel(
            name="Envoi",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("nom", models.CharField(max_length=200, unique=True)),
                ("date_debut", models.DateField(default=timezone.localdate)),
                ("date_fin", models.DateField(blank=True, null=True)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["-date_debut", "-id"],
            },
        ),
        migrations.AddField(
            model_name="auditevent",
            name="envoi",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="audit_events",
                to="inventory.envoi",
            ),
        ),
        migrations.AddField(
            model_name="produit",
            name="envoi",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="produits",
                to="inventory.envoi",
            ),
        ),
        migrations.RunPython(backfill_default_envoi, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="produit",
            name="envoi",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="produits",
                to="inventory.envoi",
            ),
        ),
    ]
