from django.urls import include, path
from rest_framework.routers import DefaultRouter

from inventory.views import (
    AuditEventViewSet,
    DetteViewSet,
    EnvoiViewSet,
    ExportMonthlyCsvView,
    ExportMonthlyXlsxView,
    ExportStockCsvView,
    ExportStockXlsxView,
    ExportTransactionsCsvView,
    ExportTransactionsXlsxView,
    HealthView,
    MeView,
    MonthlyReportView,
    ProductImportView,
    ProduitViewSet,
    StockReportView,
    StockViewSet,
    TauxChangeViewSet,
    TransactionViewSet,
)

router = DefaultRouter()
router.register(r"audit", AuditEventViewSet, basename="audit")
router.register(r"envois", EnvoiViewSet)
router.register(r"products", ProduitViewSet)
router.register(r"stocks", StockViewSet)
router.register(r"transactions", TransactionViewSet)
router.register(r"exchange-rates", TauxChangeViewSet)
router.register(r"debts", DetteViewSet)

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("me/", MeView.as_view(), name="me"),
    path("products/import/", ProductImportView.as_view(), name="products-import"),
    path("report/stock/", StockReportView.as_view(), name="report-stock"),
    path("report/monthly/", MonthlyReportView.as_view(), name="report-monthly"),
    path("export/transactions.xlsx", ExportTransactionsXlsxView.as_view(), name="export-transactions"),
    path("export/transactions.csv", ExportTransactionsCsvView.as_view(), name="export-transactions-csv"),
    path("export/stock.xlsx", ExportStockXlsxView.as_view(), name="export-stock"),
    path("export/stock.csv", ExportStockCsvView.as_view(), name="export-stock-csv"),
    path("export/monthly.xlsx", ExportMonthlyXlsxView.as_view(), name="export-monthly"),
    path("export/monthly.csv", ExportMonthlyCsvView.as_view(), name="export-monthly-csv"),
    path("", include(router.urls)),
]
