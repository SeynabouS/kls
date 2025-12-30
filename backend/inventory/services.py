from __future__ import annotations

from contextlib import contextmanager
from decimal import Decimal
from threading import local

from django.db.models import Sum
from django.utils import timezone

from inventory.models import Dette, Stock, TauxChange, Transaction

_state = local()


def is_stock_recalc_disabled() -> bool:
    return bool(getattr(_state, "disable_stock_recalc", False))


@contextmanager
def disable_stock_recalc():
    previous = getattr(_state, "disable_stock_recalc", False)
    _state.disable_stock_recalc = True
    try:
        yield
    finally:
        _state.disable_stock_recalc = previous


def get_current_exchange_rate() -> Decimal | None:
    current = TauxChange.objects.order_by("-date_application", "-id").first()
    if not current:
        return None
    return current.taux_euro_cfa


def recalculate_stock_for_product(produit_id: int) -> Stock:
    achats = (
        Transaction.objects.filter(
            produit_id=produit_id,
            type_transaction=Transaction.TypeTransaction.ACHAT,
        ).aggregate(total=Sum("quantite"))["total"]
        or 0
    )
    ventes = (
        Transaction.objects.filter(
            produit_id=produit_id,
            type_transaction=Transaction.TypeTransaction.VENTE,
        ).aggregate(total=Sum("quantite"))["total"]
        or 0
    )
    dettes_en_cours = (
        Dette.objects.filter(
            produit_id=produit_id,
            date_retour_effective__isnull=True,
        ).aggregate(total=Sum("quantite_pretee"))["total"]
        or 0
    )

    quantite_restante = max(achats - ventes - dettes_en_cours, 0)

    stock, _created = Stock.objects.get_or_create(produit_id=produit_id)
    stock.quantite_initial = achats
    stock.quantite_vendue = ventes
    stock.quantite_pretee = dettes_en_cours
    stock.quantite_restante = quantite_restante
    stock.date_mise_a_jour = timezone.now()
    stock.save(
        update_fields=[
            "quantite_initial",
            "quantite_vendue",
            "quantite_pretee",
            "quantite_restante",
            "date_mise_a_jour",
        ]
    )
    return stock
