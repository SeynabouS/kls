from __future__ import annotations

from datetime import datetime, time

from django.core.management.base import BaseCommand
from django.db import transaction as db_transaction
from django.utils import timezone

from inventory.models import Dette, Produit, Transaction
from inventory.services import recalculate_stock_for_product


class Command(BaseCommand):
    help = "Sync legacy pret/retour into credit-sale debts and recompute stock."

    def handle(self, *args, **options):  # noqa: ARG002
        updated_debts = 0
        created_debts = 0
        converted_transactions = 0
        deleted_retours = 0

        with db_transaction.atomic():
            debts = Dette.objects.select_related("transaction_pret", "transaction_retour").all()
            for debt in debts:
                if debt.transaction_retour_id is not None:
                    tx_retour = debt.transaction_retour
                    debt.transaction_retour = None
                    debt.save(update_fields=["transaction_retour"])
                    if tx_retour is not None:
                        tx_retour.delete()
                        deleted_retours += 1

                tx = debt.transaction_pret
                if tx is None:
                    continue

                update_fields: list[str] = []
                desired_type = (
                    Transaction.TypeTransaction.VENTE
                    if debt.date_retour_effective
                    else Transaction.TypeTransaction.PRET
                )
                if tx.type_transaction != desired_type:
                    tx.type_transaction = desired_type
                    update_fields.append("type_transaction")

                tx_date = debt.date_retour_effective if debt.date_retour_effective else debt.date_pret
                tx_at = timezone.make_aware(datetime.combine(tx_date, time.min))
                if tx.date_transaction != tx_at:
                    tx.date_transaction = tx_at
                    update_fields.append("date_transaction")

                if tx.client_fournisseur != debt.client:
                    tx.client_fournisseur = debt.client
                    update_fields.append("client_fournisseur")

                if tx.prix_unitaire_euro is not None:
                    tx.prix_unitaire_euro = None
                    update_fields.append("prix_unitaire_euro")
                if tx.taux_change is not None:
                    tx.taux_change = None
                    update_fields.append("taux_change")

                desired_notes = f"Dette #{debt.id} ({'payee' if debt.date_retour_effective else 'non payee'})"
                if tx.notes != desired_notes:
                    tx.notes = desired_notes
                    update_fields.append("notes")

                if update_fields:
                    tx.save(update_fields=update_fields)
                    updated_debts += 1

            orphan_retours = Transaction.objects.filter(
                type_transaction=Transaction.TypeTransaction.RETOUR
            )
            deleted_retours += orphan_retours.count()
            orphan_retours.delete()

            linked_tx_ids = set(
                Dette.objects.exclude(transaction_pret__isnull=True).values_list(
                    "transaction_pret_id", flat=True
                )
            )
            legacy_prets = Transaction.objects.filter(
                type_transaction=Transaction.TypeTransaction.PRET
            ).select_related("produit")
            for tx in legacy_prets:
                tx.prix_unitaire_euro = None
                tx.taux_change = None
                if not tx.notes:
                    tx.notes = "Dette (legacy)"
                tx.save(update_fields=["prix_unitaire_euro", "taux_change", "notes"])

                if tx.id in linked_tx_ids:
                    continue

                created = Dette.objects.create(
                    produit=tx.produit,
                    client=tx.client_fournisseur or "Inconnu",
                    quantite_pretee=tx.quantite,
                    date_pret=timezone.localtime(tx.date_transaction).date(),
                    date_retour_prevue=None,
                    date_retour_effective=None,
                    statut=Dette.Statut.EN_COURS,
                    transaction_pret=tx,
                )
                created_debts += 1

        products = list(Produit.objects.values_list("id", flat=True))
        for pid in products:
            recalculate_stock_for_product(pid)

        self.stdout.write(
            self.style.SUCCESS(
                "sync_inventory_data: "
                f"updated_debts={updated_debts}, "
                f"created_debts={created_debts}, "
                f"converted_transactions={converted_transactions}, "
                f"deleted_retours={deleted_retours}, "
                f"recalculated_products={len(products)}"
            )
        )
