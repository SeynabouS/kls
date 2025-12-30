from django.contrib import admin

from inventory.models import AuditEvent, Dette, Envoi, Produit, Stock, TauxChange, Transaction


@admin.register(Envoi)
class EnvoiAdmin(admin.ModelAdmin):
    list_display = ("nom", "date_debut", "date_fin", "is_archived", "created_at")
    search_fields = ("nom", "notes")
    list_filter = ("is_archived", "date_debut", "date_fin")


@admin.register(Produit)
class ProduitAdmin(admin.ModelAdmin):
    list_display = (
        "envoi",
        "nom",
        "categorie",
        "prix_achat_unitaire_euro",
        "prix_vente_unitaire_cfa",
        "image",
        "created_at",
    )
    search_fields = ("nom", "categorie", "envoi__nom")
    list_filter = ("envoi", "categorie")


@admin.register(Stock)
class StockAdmin(admin.ModelAdmin):
    list_display = (
        "produit",
        "quantite_initial",
        "quantite_vendue",
        "quantite_pretee",
        "quantite_restante",
        "date_mise_a_jour",
    )
    search_fields = ("produit__nom",)
    list_filter = ("produit__envoi",)


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        "date_transaction",
        "type_transaction",
        "produit",
        "quantite",
        "prix_unitaire_euro",
        "prix_unitaire_cfa",
        "taux_change",
        "client_fournisseur",
    )
    list_filter = ("type_transaction", "date_transaction")
    search_fields = ("produit__nom", "produit__envoi__nom", "client_fournisseur", "notes")


@admin.register(TauxChange)
class TauxChangeAdmin(admin.ModelAdmin):
    list_display = ("date_application", "taux_euro_cfa", "utilisateur")
    list_filter = ("date_application",)


@admin.register(Dette)
class DetteAdmin(admin.ModelAdmin):
    list_display = (
        "date_pret",
        "produit",
        "client",
        "quantite_pretee",
        "date_retour_prevue",
        "date_retour_effective",
        "statut",
    )
    list_filter = ("statut",)
    search_fields = ("produit__nom", "produit__envoi__nom", "client")


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "action", "entity", "object_id", "username", "envoi", "path")
    search_fields = ("username", "entity", "object_id", "object_repr", "message", "path")
    list_filter = ("action", "entity", "envoi", "created_at")
