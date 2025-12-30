from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal

from django.db import transaction as db_transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

from inventory.models import AuditEvent, Dette, Envoi, Produit, Stock, TauxChange, Transaction
from inventory.services import get_current_exchange_rate, recalculate_stock_for_product


class StockSerializer(serializers.ModelSerializer):
    class Meta:
        model = Stock
        fields = (
            "id",
            "produit",
            "quantite_initial",
            "quantite_vendue",
            "quantite_pretee",
            "quantite_restante",
            "date_mise_a_jour",
        )
        read_only_fields = ("id", "date_mise_a_jour")


class ProduitSerializer(serializers.ModelSerializer):
    stock = StockSerializer(read_only=True)

    class Meta:
        model = Produit
        fields = (
            "id",
            "envoi",
            "nom",
            "caracteristiques",
            "prix_achat_unitaire_euro",
            "prix_vente_unitaire_cfa",
            "image",
            "image_url",
            "categorie",
            "created_at",
            "stock",
        )
        read_only_fields = ("id", "envoi", "created_at", "stock")

    def validate(self, attrs):
        instance: Produit | None = getattr(self, "instance", None)
        if instance is None:
            prix_vente = attrs.get("prix_vente_unitaire_cfa")
            if prix_vente is None:
                raise serializers.ValidationError(
                    {"prix_vente_unitaire_cfa": "Prix de vente requis (CFA)."}
                )
            if prix_vente <= 0:
                raise serializers.ValidationError(
                    {"prix_vente_unitaire_cfa": "Prix de vente invalide (CFA)."}
                )
        return attrs


class TransactionSerializer(serializers.ModelSerializer):
    total_euro = serializers.SerializerMethodField()
    total_cfa = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = (
            "id",
            "produit",
            "type_transaction",
            "quantite",
            "prix_unitaire_euro",
            "prix_unitaire_cfa",
            "taux_change",
            "date_transaction",
            "client_fournisseur",
            "notes",
            "total_euro",
            "total_cfa",
        )
        read_only_fields = ("id", "total_euro", "total_cfa")

    def get_total_euro(self, obj: Transaction) -> Decimal | None:
        if obj.prix_unitaire_euro is None:
            return None
        return Decimal(obj.quantite) * obj.prix_unitaire_euro

    def get_total_cfa(self, obj: Transaction) -> Decimal | None:
        if obj.prix_unitaire_cfa is not None:
            return Decimal(obj.quantite) * obj.prix_unitaire_cfa
        if obj.prix_unitaire_euro is None:
            return None
        taux = obj.taux_change or get_current_exchange_rate()
        if taux is None:
            return None
        return Decimal(obj.quantite) * obj.prix_unitaire_euro * taux

    def validate(self, attrs):
        instance: Transaction | None = getattr(self, "instance", None)

        if instance is not None:
            if "produit" in attrs and attrs["produit"].id != instance.produit_id:
                raise serializers.ValidationError(
                    {
                        "produit": "Modification du produit non supportée (supprimez et recréez la transaction)."
                    }
                )
            if "type_transaction" in attrs and attrs["type_transaction"] != instance.type_transaction:
                raise serializers.ValidationError(
                    {
                        "type_transaction": "Modification du type non supportée (supprimez et recréez la transaction)."
                    }
                )

        produit = attrs.get("produit") or (instance.produit if instance else None)
        type_transaction = attrs.get("type_transaction") or (
            instance.type_transaction if instance else None
        )
        quantite = attrs.get("quantite") or (instance.quantite if instance else None)

        if not produit or not type_transaction or not quantite:
            return attrs

        qs = Transaction.objects.filter(produit_id=produit.id)
        if instance is not None:
            qs = qs.exclude(pk=instance.pk)

        achats = (
            qs.filter(type_transaction=Transaction.TypeTransaction.ACHAT).aggregate(
                total=Sum("quantite")
            )["total"]
            or 0
        )
        ventes = (
            qs.filter(type_transaction=Transaction.TypeTransaction.VENTE).aggregate(
                total=Sum("quantite")
            )["total"]
            or 0
        )
        dettes_en_cours = (
            Dette.objects.filter(produit_id=produit.id, date_retour_effective__isnull=True).aggregate(
                total=Sum("quantite_pretee")
            )["total"]
            or 0
        )

        if type_transaction == Transaction.TypeTransaction.ACHAT:
            achats += quantite
        elif type_transaction == Transaction.TypeTransaction.VENTE:
            ventes += quantite
        elif type_transaction in (
            Transaction.TypeTransaction.PRET,
            Transaction.TypeTransaction.RETOUR,
        ):
            raise serializers.ValidationError(
                {
                    "type_transaction": "Type 'pret/retour' non supporté (utilise l'onglet Dettes clients)."
                }
            )

        quantite_restante = achats - ventes - dettes_en_cours
        if quantite_restante < 0 and type_transaction == Transaction.TypeTransaction.VENTE:
            raise serializers.ValidationError(
                {"quantite": "Stock insuffisant pour cette opération."}
            )

        prix_unitaire_euro = attrs.get("prix_unitaire_euro")
        prix_unitaire_cfa = attrs.get("prix_unitaire_cfa")
        taux_change = attrs.get("taux_change")

        if prix_unitaire_euro is not None and prix_unitaire_cfa is None:
            taux = taux_change or get_current_exchange_rate()
            if taux is not None:
                attrs["taux_change"] = taux
                attrs["prix_unitaire_cfa"] = (prix_unitaire_euro * taux).quantize(
                    Decimal("0.01")
                )

        effective_prix_cfa = (
            attrs["prix_unitaire_cfa"]
            if "prix_unitaire_cfa" in attrs
            else (instance.prix_unitaire_cfa if instance else None)
        )

        if type_transaction == Transaction.TypeTransaction.VENTE:
            if effective_prix_cfa is None:
                default_price = getattr(produit, "prix_vente_unitaire_cfa", None)
                if default_price is not None:
                    attrs["prix_unitaire_cfa"] = default_price.quantize(Decimal("0.01"))
                    return attrs
                raise serializers.ValidationError(
                    {"prix_unitaire_cfa": "Prix de vente requis (CFA)."}
                )

        return attrs


class AuditEventSerializer(serializers.ModelSerializer):
    user_display = serializers.SerializerMethodField()
    envoi_nom = serializers.SerializerMethodField()

    class Meta:
        model = AuditEvent
        fields = (
            "id",
            "created_at",
            "action",
            "entity",
            "object_id",
            "object_repr",
            "message",
            "username",
            "user",
            "user_display",
            "envoi",
            "envoi_nom",
            "path",
            "method",
            "ip_address",
            "metadata",
        )
        read_only_fields = fields

    def get_user_display(self, obj: AuditEvent) -> str:
        user = obj.user
        if user and (getattr(user, "first_name", "") or getattr(user, "last_name", "")):
            name = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
            if name:
                return name
        if obj.username:
            return obj.username
        if user:
            return getattr(user, "username", "") or user.get_username()
        return ""

    def get_envoi_nom(self, obj: AuditEvent) -> str:
        envoi = getattr(obj, "envoi", None)
        return getattr(envoi, "nom", "") if envoi is not None else ""


class EnvoiSerializer(serializers.ModelSerializer):
    class Meta:
        model = Envoi
        fields = ("id", "nom", "date_debut", "date_fin", "notes", "is_archived", "created_at")
        read_only_fields = ("id", "created_at")

    def validate(self, attrs):
        date_debut = attrs.get("date_debut") or getattr(getattr(self, "instance", None), "date_debut", None)
        date_fin = attrs.get("date_fin") if "date_fin" in attrs else getattr(getattr(self, "instance", None), "date_fin", None)
        if date_debut and date_fin and date_fin < date_debut:
            raise serializers.ValidationError({"date_fin": "La date de fin doit être >= date de début."})
        return attrs


class TauxChangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = TauxChange
        fields = ("id", "taux_euro_cfa", "date_application", "utilisateur")
        read_only_fields = ("id", "utilisateur")

    def create(self, validated_data):
        user = self.context["request"].user
        validated_data["utilisateur"] = user if user.is_authenticated else None
        return super().create(validated_data)


class DetteSerializer(serializers.ModelSerializer):
    prix_unitaire_cfa = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
        write_only=True,
    )

    class Meta:
        model = Dette
        fields = (
            "id",
            "produit",
            "client",
            "quantite_pretee",
            "date_pret",
            "date_retour_prevue",
            "date_retour_effective",
            "statut",
            "transaction_pret",
            "transaction_retour",
            "prix_unitaire_cfa",
        )
        read_only_fields = ("id", "statut", "transaction_pret", "transaction_retour")

    def _compute_status(
        self,
        *,
        date_retour_effective: date | None,
        date_retour_prevue: date | None,
    ) -> str:
        if date_retour_effective:
            return Dette.Statut.RETOURNE
        if date_retour_prevue and date_retour_prevue < timezone.localdate():
            return Dette.Statut.RETARD
        return Dette.Statut.EN_COURS

    @db_transaction.atomic
    def create(self, validated_data):
        prix_unitaire_cfa = validated_data.pop("prix_unitaire_cfa", None)
        produit = validated_data["produit"]
        quantite = validated_data["quantite_pretee"]

        if prix_unitaire_cfa is None:
            prix_unitaire_cfa = produit.prix_vente_unitaire_cfa
        if prix_unitaire_cfa is None:
            raise serializers.ValidationError(
                {"prix_unitaire_cfa": "Prix de vente requis (CFA) pour une dette client."}
            )
        if prix_unitaire_cfa <= 0:
            raise serializers.ValidationError(
                {"prix_unitaire_cfa": "Prix de vente invalide (CFA) pour une dette client."}
            )

        stock = recalculate_stock_for_product(produit.id)
        if stock.quantite_restante < quantite:
            raise serializers.ValidationError(
                {"quantite_pretee": "Stock insuffisant pour enregistrer cette vente à crédit."}
            )

        validated_data["statut"] = self._compute_status(
            date_retour_effective=validated_data.get("date_retour_effective"),
            date_retour_prevue=validated_data.get("date_retour_prevue"),
        )
        dette = super().create(validated_data)

        is_paid = dette.date_retour_effective is not None
        tx_date = dette.date_retour_effective if is_paid else dette.date_pret
        tx_at = timezone.make_aware(datetime.combine(tx_date, time.min))
        tx = Transaction.objects.create(
            produit=produit,
            type_transaction=Transaction.TypeTransaction.VENTE
            if is_paid
            else Transaction.TypeTransaction.PRET,
            quantite=quantite,
            prix_unitaire_cfa=prix_unitaire_cfa,
            client_fournisseur=dette.client,
            date_transaction=tx_at,
            notes=f"Dette #{dette.id} ({'payee' if is_paid else 'non payee'})",
        )
        dette.transaction_pret = tx
        dette.save(update_fields=["transaction_pret"])
        return dette

    @db_transaction.atomic
    def update(self, instance: Dette, validated_data):
        prix_unitaire_cfa = validated_data.pop("prix_unitaire_cfa", None)

        if "produit" in validated_data and validated_data["produit"].id != instance.produit_id:
            raise serializers.ValidationError(
                {
                    "produit": "Modification du produit non supportée (supprimez et recréez la dette)."
                }
            )
        if (
            "quantite_pretee" in validated_data
            and validated_data["quantite_pretee"] != instance.quantite_pretee
        ):
            raise serializers.ValidationError(
                {
                    "quantite_pretee": "Modification de la quantité non supportée (supprimez et recréez la dette)."
                }
            )

        date_retour_effective = validated_data.get(
            "date_retour_effective", instance.date_retour_effective
        )
        date_retour_prevue = validated_data.get("date_retour_prevue", instance.date_retour_prevue)
        validated_data["statut"] = self._compute_status(
            date_retour_effective=date_retour_effective,
            date_retour_prevue=date_retour_prevue,
        )

        is_paid = date_retour_effective is not None

        instance = super().update(instance, validated_data)

        if instance.transaction_retour_id is not None:
            tx_retour = instance.transaction_retour
            instance.transaction_retour = None
            instance.save(update_fields=["transaction_retour"])
            if tx_retour:
                tx_retour.delete()

        tx = instance.transaction_pret
        if tx is None:
            if prix_unitaire_cfa is None:
                prix_unitaire_cfa = instance.produit.prix_vente_unitaire_cfa
            if prix_unitaire_cfa is None:
                raise serializers.ValidationError(
                    {
                        "transaction_pret": "Transaction dette manquante. Renseigne prix_unitaire_cfa pour la recréer."
                    }
                )

            tx_date = date_retour_effective if is_paid else instance.date_pret
            tx_at = timezone.make_aware(datetime.combine(tx_date, time.min))
            tx = Transaction.objects.create(
                produit=instance.produit,
                type_transaction=Transaction.TypeTransaction.VENTE
                if is_paid
                else Transaction.TypeTransaction.PRET,
                quantite=instance.quantite_pretee,
                prix_unitaire_cfa=prix_unitaire_cfa,
                client_fournisseur=instance.client,
                date_transaction=tx_at,
                notes=f"Dette #{instance.id} ({'payee' if is_paid else 'non payee'})",
            )
            instance.transaction_pret = tx
            instance.save(update_fields=["transaction_pret"])
            return instance

        update_fields: list[str] = []

        desired_type = (
            Transaction.TypeTransaction.VENTE
            if is_paid
            else Transaction.TypeTransaction.PRET
        )
        if tx.type_transaction != desired_type:
            tx.type_transaction = desired_type
            update_fields.append("type_transaction")

        if tx.quantite != instance.quantite_pretee:
            tx.quantite = instance.quantite_pretee
            update_fields.append("quantite")

        if tx.client_fournisseur != instance.client:
            tx.client_fournisseur = instance.client
            update_fields.append("client_fournisseur")

        tx_date = date_retour_effective if is_paid else instance.date_pret
        tx_at = timezone.make_aware(datetime.combine(tx_date, time.min))
        if tx.date_transaction != tx_at:
            tx.date_transaction = tx_at
            update_fields.append("date_transaction")

        if prix_unitaire_cfa is not None and tx.prix_unitaire_cfa != prix_unitaire_cfa:
            tx.prix_unitaire_cfa = prix_unitaire_cfa
            update_fields.append("prix_unitaire_cfa")

        if tx.prix_unitaire_euro is not None:
            tx.prix_unitaire_euro = None
            update_fields.append("prix_unitaire_euro")
        if tx.taux_change is not None:
            tx.taux_change = None
            update_fields.append("taux_change")

        if tx.prix_unitaire_cfa is None:
            default_price = instance.produit.prix_vente_unitaire_cfa
            if default_price is None:
                raise serializers.ValidationError(
                    {"prix_unitaire_cfa": "Prix de vente requis (CFA) pour une dette client."}
                )
            tx.prix_unitaire_cfa = default_price.quantize(Decimal("0.01"))
            update_fields.append("prix_unitaire_cfa")

        desired_notes = f"Dette #{instance.id} ({'payee' if is_paid else 'non payee'})"
        if tx.notes != desired_notes:
            tx.notes = desired_notes
            update_fields.append("notes")

        if update_fields:
            tx.save(update_fields=update_fields)

        return instance
