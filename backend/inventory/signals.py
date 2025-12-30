from __future__ import annotations

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from inventory.models import Dette, Produit, Stock, Transaction
from inventory.services import is_stock_recalc_disabled, recalculate_stock_for_product


@receiver(post_save, sender=Produit)
def ensure_stock_exists(sender, instance: Produit, **kwargs):  # noqa: ARG001
    Stock.objects.get_or_create(produit=instance)


@receiver(pre_save, sender=Produit)
def produit_pre_save(sender, instance: Produit, **kwargs):  # noqa: ARG001
    if not instance.pk:
        instance._old_image_name = None  # type: ignore[attr-defined]
        return

    try:
        old = Produit.objects.get(pk=instance.pk)
    except Produit.DoesNotExist:
        instance._old_image_name = None  # type: ignore[attr-defined]
        return

    old_name = old.image.name if getattr(old, "image", None) else None
    new_name = instance.image.name if getattr(instance, "image", None) else None
    instance._old_image_name = old_name if old_name and old_name != new_name else None  # type: ignore[attr-defined]


@receiver(post_save, sender=Produit)
def produit_post_save(sender, instance: Produit, **kwargs):  # noqa: ARG001
    old_name = getattr(instance, "_old_image_name", None)
    if not old_name:
        return
    try:
        instance.image.storage.delete(old_name)
    except Exception:  # noqa: BLE001
        pass


@receiver(post_delete, sender=Produit)
def produit_post_delete(sender, instance: Produit, **kwargs):  # noqa: ARG001
    try:
        if getattr(instance, "image", None) and instance.image.name:
            instance.image.delete(save=False)
    except Exception:  # noqa: BLE001
        pass


@receiver(pre_save, sender=Transaction)
def transaction_pre_save(sender, instance: Transaction, **kwargs):  # noqa: ARG001
    if not instance.pk:
        instance._old_produit_id = None  # type: ignore[attr-defined]
        return

    try:
        old = Transaction.objects.get(pk=instance.pk)
    except Transaction.DoesNotExist:
        instance._old_produit_id = None  # type: ignore[attr-defined]
        return

    instance._old_produit_id = old.produit_id  # type: ignore[attr-defined]


@receiver(post_save, sender=Transaction)
def transaction_post_save(sender, instance: Transaction, **kwargs):  # noqa: ARG001
    if is_stock_recalc_disabled():
        return
    produit_ids = {instance.produit_id}
    old_id = getattr(instance, "_old_produit_id", None)
    if old_id and old_id != instance.produit_id:
        produit_ids.add(old_id)

    for produit_id in produit_ids:
        recalculate_stock_for_product(produit_id)


@receiver(post_delete, sender=Transaction)
def transaction_post_delete(sender, instance: Transaction, **kwargs):  # noqa: ARG001
    if is_stock_recalc_disabled():
        return
    recalculate_stock_for_product(instance.produit_id)


@receiver(post_save, sender=Dette)
def dette_post_save(sender, instance: Dette, **kwargs):  # noqa: ARG001
    if is_stock_recalc_disabled():
        return
    recalculate_stock_for_product(instance.produit_id)


@receiver(post_delete, sender=Dette)
def dette_post_delete(sender, instance: Dette, **kwargs):  # noqa: ARG001
    if is_stock_recalc_disabled():
        return
    recalculate_stock_for_product(instance.produit_id)
