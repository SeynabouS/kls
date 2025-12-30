from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class Envoi(models.Model):
    nom = models.CharField(max_length=200, unique=True)
    date_debut = models.DateField(default=timezone.localdate)
    date_fin = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date_debut", "-id"]

    def __str__(self) -> str:
        if self.date_fin:
            return f"{self.nom} ({self.date_debut} - {self.date_fin})"
        return f"{self.nom} ({self.date_debut})"


class Produit(models.Model):
    envoi = models.ForeignKey(Envoi, on_delete=models.CASCADE, related_name="produits")
    nom = models.CharField(max_length=200)
    caracteristiques = models.TextField(blank=True, default="")
    prix_achat_unitaire_euro = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
    )
    prix_vente_unitaire_cfa = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
    )
    image = models.FileField(upload_to="products/", null=True, blank=True)
    image_url = models.URLField(max_length=500, blank=True, default="")
    categorie = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["nom", "id"]

    def __str__(self) -> str:
        return self.nom


class Stock(models.Model):
    produit = models.OneToOneField(Produit, on_delete=models.CASCADE, related_name="stock")
    quantite_initial = models.PositiveIntegerField(default=0)
    quantite_vendue = models.PositiveIntegerField(default=0)
    quantite_restante = models.PositiveIntegerField(default=0)
    quantite_pretee = models.PositiveIntegerField(default=0)
    date_mise_a_jour = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["produit__nom", "id"]

    def __str__(self) -> str:
        return f"Stock({self.produit.nom})"


class Transaction(models.Model):
    class TypeTransaction(models.TextChoices):
        ACHAT = "achat", "Achat"
        VENTE = "vente", "Vente"
        PRET = "pret", "Prêt"
        RETOUR = "retour", "Retour"

    produit = models.ForeignKey(
        Produit,
        on_delete=models.PROTECT,
        related_name="transactions",
    )
    type_transaction = models.CharField(max_length=20, choices=TypeTransaction.choices)
    quantite = models.PositiveIntegerField()
    prix_unitaire_euro = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
    )
    prix_unitaire_cfa = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
    )
    taux_change = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Taux EUR -> CFA appliqué à cette transaction",
    )
    date_transaction = models.DateTimeField(default=timezone.now)
    client_fournisseur = models.CharField(max_length=200, blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-date_transaction", "-id"]

    def __str__(self) -> str:
        return f"{self.type_transaction} - {self.produit.nom} x{self.quantite}"


class TauxChange(models.Model):
    taux_euro_cfa = models.DecimalField(max_digits=10, decimal_places=2)
    date_application = models.DateField(default=timezone.localdate)
    utilisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="taux_change",
    )

    class Meta:
        ordering = ["-date_application", "-id"]

    def __str__(self) -> str:
        return f"{self.taux_euro_cfa} ({self.date_application})"


class Dette(models.Model):
    class Statut(models.TextChoices):
        EN_COURS = "en_cours", "En cours"
        RETOURNE = "retourne", "Retourné"
        RETARD = "retard", "En retard"

    produit = models.ForeignKey(
        Produit,
        on_delete=models.PROTECT,
        related_name="dettes",
    )
    client = models.CharField(max_length=200)
    quantite_pretee = models.PositiveIntegerField()
    date_pret = models.DateField(default=timezone.localdate)
    date_retour_prevue = models.DateField(null=True, blank=True)
    date_retour_effective = models.DateField(null=True, blank=True)
    statut = models.CharField(
        max_length=20,
        choices=Statut.choices,
        default=Statut.EN_COURS,
    )

    transaction_pret = models.OneToOneField(
        Transaction,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="dette_pret",
    )
    transaction_retour = models.OneToOneField(
        Transaction,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="dette_retour",
    )

    class Meta:
        ordering = ["-date_pret", "-id"]

    def __str__(self) -> str:
        return f"Dette({self.client} - {self.produit.nom} x{self.quantite_pretee})"


class AuditEvent(models.Model):
    class Action(models.TextChoices):
        LOGIN = "login", "Login"
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        DELETE = "delete", "Delete"
        IMPORT = "import", "Import"
        PURGE = "purge", "Purge"

    created_at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_events",
    )
    username = models.CharField(max_length=150, blank=True, default="")
    envoi = models.ForeignKey(
        "inventory.Envoi",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_events",
    )

    action = models.CharField(max_length=20, choices=Action.choices)
    entity = models.CharField(max_length=50, blank=True, default="")
    object_id = models.CharField(max_length=64, blank=True, default="")
    object_repr = models.CharField(max_length=200, blank=True, default="")
    message = models.TextField(blank=True, default="")
    path = models.CharField(max_length=300, blank=True, default="")
    method = models.CharField(max_length=10, blank=True, default="")
    ip_address = models.CharField(max_length=64, blank=True, default="")
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        who = self.username or (self.user.username if self.user_id else "")
        target = f"{self.entity}#{self.object_id}" if self.entity and self.object_id else self.entity
        return f"{self.action} {target} by {who}".strip()
