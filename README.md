# KLS Tracking (Django + PostgreSQL + Frontend statique)

## Démarrage rapide (Docker)

1) Copier `.env.example` vers `.env` et modifier les valeurs `change_me` (au minimum `POSTGRES_PASSWORD` et `DJANGO_SECRET_KEY`).
   - Si `DJANGO_SECRET_KEY` n'est pas fourni, l'app génère un secret et le persiste dans `backend/.django_secret_key`.
   - Attention: si tu as déjà un volume Postgres existant, garde le même `POSTGRES_PASSWORD` ou fais un reset (`docker compose down -v`) sinon la connexion à la base échouera.

2) Lancer la stack :

```powershell
# Optionnel si tu as des ports déjà pris
$env:NGINX_PORT=8080
$env:BACKEND_PORT=8001

docker compose up -d --build
```

3) Ouvrir :
- Frontend: `http://localhost:${NGINX_PORT:-80}/`
- Admin Django: `http://localhost:${NGINX_PORT:-80}/admin/`
- pgAdmin: `http://localhost:${PGADMIN_PORT:-5050}/`

Note: par défaut, `postgres`, `pgadmin` et le port `backend` sont bindés sur `127.0.0.1` (non exposés au réseau). L'accès "public" se fait via `nginx` (port `NGINX_PORT`).

## Tester (rapide)

### Depuis le navigateur

1) Ouvre `http://localhost:${NGINX_PORT:-80}/` (dans ce repo je l’ai lancé sur `http://localhost:8080/`).
2) Connecte-toi avec le compte admin configuré (`DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_PASSWORD`).
3) Choisis (ou crée) un **envoi** : toutes les pages (produits, stocks, transactions, rapports, exports) sont liées à un envoi.
4) Va sur :
   - **Envois** (admin) → gérer les envois (créer / modifier / archiver / supprimer)
   - **Produits** → crée un produit (upload image possible), **Import Excel**, puis utilise les filtres avancés au-dessus de la liste
   - **Transactions** → ajoute un `achat`, puis une `vente`
   - **Dettes clients** → crée une dette (vente à crédit), puis "Marquer payée" (la quantité passe de Dettes → Vendu, sans remettre en stock)
   - **Taux** → ajoute un taux EUR→CFA et reviens au dashboard

### En API (PowerShell)

```powershell
# Health
Invoke-WebRequest http://localhost:8080/api/health/ -UseBasicParsing | Select -Expand Content

# Token JWT
$username = "<username>"
$password = "<password>"
$token = (Invoke-RestMethod -Method Post http://localhost:8080/api/auth/token/ -ContentType application/json -Body (@{username=$username;password=$password}|ConvertTo-Json)).access

# Lister les envois (et récupérer un envoi_id)
$envoiId = (Invoke-RestMethod http://localhost:8080/api/envois/ -Headers @{Authorization="Bearer $token"})[0].id

# Créer un produit
Invoke-RestMethod -Method Post "http://localhost:8080/api/products/?envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} -ContentType application/json -Body (@{nom="Produit Test"; categorie="Demo"; prix_achat_unitaire_euro="12.50"; prix_vente_unitaire_cfa="15000"}|ConvertTo-Json)

# Ajouter un achat (augmente le stock)
Invoke-RestMethod -Method Post "http://localhost:8080/api/transactions/?envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} -ContentType application/json -Body (@{produit=1; type_transaction="achat"; quantite=10; prix_unitaire_euro="12.50"}|ConvertTo-Json)

# Dashboard "type Excel" (rapport stock)
Invoke-RestMethod "http://localhost:8080/api/report/stock/?envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} | ConvertTo-Json -Depth 5

# Rapport mensuel
Invoke-RestMethod "http://localhost:8080/api/report/monthly/?year=2025&envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} | ConvertTo-Json -Depth 6

# Export Transactions (.xlsx)
Invoke-WebRequest "http://localhost:8080/api/export/transactions.xlsx?envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} -OutFile transactions.xlsx

# Export Stock (.xlsx/.csv)
Invoke-WebRequest "http://localhost:8080/api/export/stock.xlsx?envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} -OutFile stock.xlsx
Invoke-WebRequest "http://localhost:8080/api/export/stock.csv?envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} -OutFile stock.csv

# Export Rapport mensuel (.xlsx/.csv)
Invoke-WebRequest "http://localhost:8080/api/export/monthly.xlsx?year=2025&envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} -OutFile monthly_2025.xlsx
Invoke-WebRequest "http://localhost:8080/api/export/monthly.csv?year=2025&envoi_id=$envoiId" -Headers @{Authorization="Bearer $token"} -OutFile monthly_2025.csv
```

## Authentification

Un superuser est créé automatiquement au démarrage (si `DJANGO_SUPERUSER_USERNAME` et `DJANGO_SUPERUSER_PASSWORD` sont définis).
Pour forcer la mise à jour du mot de passe si l'utilisateur existe déjà: `DJANGO_SUPERUSER_UPDATE_PASSWORD=1`.

Conseil: en production (Render), utilise un mot de passe fort et définis les variables d’environnement directement dans Render (ne commit jamais `.env`).

## API (principales routes)

- JWT: `POST /api/auth/token/` et `POST /api/auth/token/refresh/`
- Envois: `/api/envois/` (les autres ressources sont liées à un envoi via `envoi_id`)
- Produits: `/api/products/`
- Import produits (Excel): `POST /api/products/import/?mode=append|upsert` (multipart, champ `file`). Par défaut `mode=append` (1 ligne = 1 produit). Colonnes reconnues: Nom/Produit, Catégorie, Caractéristiques, PAU (€)/(CFA), PVU (CFA)/(€), Image URL (optionnel, uniquement si URL http(s)), Quantité/Qté/Stock initial (crée un achat → stock initial). En `mode=upsert`, si plusieurs produits ont le même nom, ils sont fusionnés et le produit final est mis à jour. Réponse: `created/updated/merged/skipped/errors` (avec détails par ligne).
  - Si tu vois une erreur `413 Request Entity Too Large`, augmente `client_max_body_size` dans `nginx/nginx.conf` (ou réduis la taille du fichier).
- Transactions: `/api/transactions/`
- Stocks (lecture): `/api/stocks/`
- Dettes: `/api/debts/`
- Taux: `/api/exchange-rates/` et `GET /api/exchange-rates/current/`
- Rapport stock (tableau type Excel): `GET /api/report/stock/`
- Rapport mensuel (achats/ventes): `GET /api/report/monthly/?year=2025`
- Export (Excel/CSV):
  - `GET /api/export/stock.xlsx`
  - `GET /api/export/stock.csv`
  - `GET /api/export/transactions.xlsx`
  - `GET /api/export/transactions.csv`
  - `GET /api/export/monthly.xlsx?year=2025`
  - `GET /api/export/monthly.csv?year=2025`

## Sauvegarde automatique

Le service `db_backup` génère un dump quotidien dans `./backups/` (format custom `pg_dump`).

## Arrêt / reset

```powershell
docker compose down
# reset complet (⚠ supprime la base)
docker compose down -v
```
