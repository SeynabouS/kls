from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0002_produit_prix_vente_unitaire_cfa"),
    ]

    operations = [
        migrations.AddField(
            model_name="produit",
            name="image",
            field=models.FileField(blank=True, null=True, upload_to="products/"),
        ),
    ]

