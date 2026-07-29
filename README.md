# All_Santé — API d'interopérabilité (bus FHIR R4)

Middleware central de la plateforme **All_Santé** : un **bus d'interopérabilité**
qui relie **SGCH**, **DPI** et **OpenELIS** autour du **matricule CMU** (clé pivot).

Au lieu d'échanges point-à-point entre chaque système, chaque partenaire parle à
AllSanté. Le bus **authentifie**, **valide** le Bundle FHIR, **journalise** (audit),
puis **route** le message vers le système aval concerné.

All_Santé assure **deux rôles distincts** :

| Rôle | Module | État |
|------|--------|------|
| **Bus FHIR** — routage SGCH ↔ DPI ↔ OpenELIS *à l'intérieur* d'un hôpital | `src/interop/` | sans base, transport pur |
| **Dépôt national** — identité pivot + historique clinique partagé *entre* hôpitaux | `src/national/` | base `allsante_global` |

C'est le dépôt national qui permet à l'Hôpital A de reconnaître au matricule un
patient qu'il n'a jamais vu, et à son médecin de lire l'historique produit à
l'Hôpital B. Conception détaillée : `../ARCHITECTURE_depot_central_allsante.md`.

## Architecture des flux

| Flux | Endpoint (entrant) | Source → Cible | Ressources FHIR |
|------|--------------------|----------------|-----------------|
| Prise en charge | `POST /interop/fhir/prise-en-charge` | SGCH → **AllSanté** → DPI | Patient + Invoice |
| Demande d'examen | `POST /interop/fhir/demande-examen` | DPI → **AllSanté** → OpenELIS | Patient + ServiceRequest |
| Résultats | `POST /interop/fhir/resultats` | OpenELIS → **AllSanté** → DPI | DiagnosticReport + Observation |

```
        SGCH ─┐                              ┌─► DPI
              ├─► ALLSANTÉ (bus interop) ─────┤
   OpenELIS ─┘   auth · valide · audit · route └─► OpenELIS
```

Authentification serveur-à-serveur par clé API (`x-api-key`), entrante comme
sortante. Les chemins reprennent exactement ceux déjà attendus par le DPI et
OpenELIS : AllSanté s'intercale **sans modifier** les systèmes existants.

## Le dépôt national (`/national`)

Base PostgreSQL `allsante_global`. Tous les appels sont authentifiés par
`x-api-key`, et l'en-tête `x-etablissement` (ex. `CHU-A`) identifie l'appelant
pour la piste d'audit.

| Endpoint | Appelé par | Rôle |
|----------|-----------|------|
| `GET /national/patients/:matricule` | SGCH | Identité pivot, dès la saisie des 13 chiffres à l'admission. `404` si inconnu → nouveau patient. |
| `GET /national/patients/:matricule/consultations` | DPI | Historique clinique consolidé. `?exclureEtablissement=CHU-A` pour n'obtenir que l'historique **externe**. `?limite=20`. |
| `GET /national/patients/:matricule/socle-vital` | DPI / urgences | Groupe sanguin, allergies, traitements au long cours. Un appel, un écran. |
| `POST /national/patients` | SGCH | Publication (upsert) de l'identité après création du patient. |
| `POST /national/consultations` | DPI | Publication d'un épisode de soin — **consentement obligatoire**. |
| `POST /national/patients/:matricule/allergies` | DPI | Déclaration d'allergie (socle vital). |
| `POST /national/patients/:matricule/traitements-chroniques` | DPI | Traitement au long cours (socle vital). |
| `PUT /national/patients/:matricule/preferences` | SGCH / DPI | Accord durable, ou opposition au socle vital. |
| `DELETE /national/consultations/:id` | DPI | Révocation : purge du contenu clinique. |

### Le modèle de partage à trois étages

La distinction n'est pas *sensible / non sensible* mais **risque vital** contre
**charge sociale**. Une allergie à la pénicilline sauve une vie et n'expose
personne ; un diagnostic psychiatrique n'a aucune urgence et peut détruire une
réputation. Les deux ne peuvent pas suivre la même règle.

| Étage | Contenu | Règle |
|-------|---------|-------|
| `SOCLE_VITAL` | Identité, groupe sanguin, allergies, traitements chroniques | Publié par défaut, opposition possible |
| `EPISODE_SOIN` | Motif, diagnostic, synthèse, résultats, prescriptions | **Consentement explicite** recueilli par le praticien |
| `CHARGE_SOCIALE` | VIH, psychiatrie, IVG, addictions, violences | Consentement **renforcé** (l'étage doit être visé nommément), et l'existence même n'est jamais signalée |

**Sans consentement, rien n'est écrit.** Ce n'est pas du masquage en lecture :
`POST /national/consultations` refuse (`400`) tout contenu clinique accompagné
d'un consentement négatif, et n'enregistre qu'un **marqueur** sans date, sans
motif, sans praticien. La donnée ne quitte jamais l'hôpital.

**Le médecin est averti, sans rien apprendre.** La réponse d'historique porte un
booléen `elementsNonPartages` — ni comptage, ni date, ni établissement, ni
nature. Le praticien sait qu'il doit interroger son patient avant une décision
engageante ; il n'apprend rien du contenu. Les épisodes en `CHARGE_SOCIALE` sont
exclus de ce signalement.

**Invariants tenus par le service :** toute opération est journalisée dans
`journaux_acces_national` — y compris les recherches infructueuses ; toute
écriture est idempotente ; et la trace du consentement est écrite dans la
**même transaction** que la donnée qu'elle autorise, jamais l'une sans l'autre.

**Ce qui ne remonte jamais au national :** les analyses IA brutes, les
consultations non clôturées, les champs de travail internes au DPI, et tout
contenu clinique non consenti.

### Mise en route de la base

```bash
# 1. créer la base (une seule fois)
psql -U postgres -c "CREATE DATABASE allsante_global;"

# 2. renseigner DATABASE_URL dans .env, puis
npm install
npm run db:migrate      # crée les tables
npm run seed:national   # 2 établissements, 4 patients, 5 consultations
```

Le seed est rejouable. Il affiche en fin d'exécution le matricule vedette de la
démonstration (`1994031200123` — Aya KOUASSI) et les clés API des établissements.

### Vérifier

```bash
curl http://localhost:3010/health

curl http://localhost:3010/national/patients/1994031200123 \
  -H "x-api-key: dev-interop-key-change-me" \
  -H "x-etablissement: CHU-A"

curl "http://localhost:3010/national/patients/1994031200123/consultations?exclureEtablissement=CHU-A" \
  -H "x-api-key: dev-interop-key-change-me" \
  -H "x-etablissement: CHU-A"
```

## Stack

- **NestJS 10** (TypeScript 5) — `@nestjs/axios` pour le routage HTTP aval
- **Contrat FHIR R4** en TypeScript pur (dossier `src/fhir/`), partagé avec le DPI
- **Prisma 7 + PostgreSQL** (driver adapter `@prisma/adapter-pg`) pour le dépôt national
- Le bus FHIR reste **sans état** : la base ne sert qu'au dépôt national

## Démarrer

```bash
npm install
cp .env.example .env      # puis renseigner les URL/clés + DATABASE_URL
npm run start:dev         # → http://localhost:3010
```

Vérifier la disponibilité et l'inventaire des routes :

```bash
curl http://localhost:3010/health
```

## Configuration (`.env`)

| Variable | Rôle | Défaut |
|----------|------|--------|
| `PORT` | Port d'écoute du bus | `3010` |
| `INTEROP_API_KEY` | Clé exigée des clients entrants | `dev-interop-key-change-me` |
| `DPI_INTEROP_URL` | URL de base du DPI (aval) | `http://localhost:3001` |
| `OPENELIS_INTEROP_URL` | URL de base d'OpenELIS (aval) | `http://localhost:3021` |
| `DPI_API_KEY` | Clé sortante vers le DPI | = `INTEROP_API_KEY` |
| `OPENELIS_API_KEY` | Clé sortante vers OpenELIS | = `INTEROP_API_KEY` |
| `INTEROP_TIMEOUT_MS` | Timeout des appels aval | `8000` |
| `DATABASE_URL` | Base PostgreSQL du dépôt national | — (requis) |

## Structure

```
allsante-api/
├── src/
│   ├── main.ts                       # bootstrap (parser FHIR+JSON)
│   ├── app.module.ts
│   ├── config/interop.config.ts      # configuration 12-factor (routes + clés)
│   ├── common/api-key.guard.ts       # authentification x-api-key entrante
│   ├── fhir/                         # contrat FHIR R4 pur (réutilisé du DPI)
│   │   ├── fhir-prise-en-charge.ts
│   │   ├── fhir-demande.ts
│   │   ├── fhir-demande-validation.ts
│   │   └── fhir-resultat.ts
│   ├── interop/                      # cœur du bus (sans état)
│   │   ├── interop.controller.ts     # 3 endpoints entrants
│   │   ├── interop.service.ts        # validation + routage aval
│   │   └── interop.module.ts
│   ├── national/                     # DÉPÔT NATIONAL
│   │   ├── dto/national.dto.ts       # contrats + validation manuelle
│   │   ├── national.controller.ts    # 4 endpoints /national
│   │   ├── national.service.ts       # upserts idempotents + audit
│   │   └── national.module.ts
│   ├── prisma/                       # connexion allsante_global
│   └── health/health.controller.ts   # sonde /health
├── prisma/
│   ├── schema.prisma                 # 6 modèles du dépôt national
│   └── seed-national.ts              # jeu de démonstration
└── .env.example
```

## Exemple d'appel

```bash
curl -X POST http://localhost:3010/interop/fhir/prise-en-charge \
  -H "Content-Type: application/fhir+json" \
  -H "x-api-key: dev-interop-key-change-me" \
  -d @bundle-prise-en-charge.json
```

Réponse (routage réussi vers le DPI) :

```json
{ "ok": true, "route": "http://localhost:3001/interop/fhir/prise-en-charge",
  "statutAval": 200, "reponseAval": { "...": "réponse du DPI" } }
```

## Principe de conception

Le contrat FHIR (`src/fhir/`) est **identique** à celui du DPI : mêmes systèmes
d'identifiants (`https://interop.sante.ci/cmu/matricule`), mêmes fonctions de
validation. Le bus les réutilise pour **rejeter tôt** (HTTP 400) tout Bundle mal
formé, avant de solliciter le système aval — garantissant qu'aucun message
invalide ne circule dans la plateforme.

---

Projet de fin de cycle — KRA Mardochée, ESATIC (Abidjan).
Conception d'un système interopérable intégrant l'IA pour le DPI et le SIH.
