from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0005_envoi"),
    ]

    operations = [
        migrations.AddField(
            model_name="envoi",
            name="is_archived",
            field=models.BooleanField(default=False),
        ),
    ]

