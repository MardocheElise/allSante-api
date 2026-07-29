-- CreateEnum
CREATE TYPE "Genre" AS ENUM ('masculin', 'feminin');

-- CreateEnum
CREATE TYPE "TypeEtablissement" AS ENUM ('CHU', 'CHR', 'HOPITAL_GENERAL', 'CENTRE_SANTE', 'CLINIQUE', 'LABORATOIRE');

-- CreateEnum
CREATE TYPE "StatutConsultationNationale" AS ENUM ('TERMINEE', 'CLOTUREE_ADMINISTRATIVEMENT', 'ANNULEE');

-- CreateEnum
CREATE TYPE "ActionNationale" AS ENUM ('LECTURE_IDENTITE', 'LECTURE_HISTORIQUE', 'PUBLICATION_IDENTITE', 'PUBLICATION_CONSULTATION', 'REFUS_AUTHENTIFICATION');

-- CreateTable
CREATE TABLE "etablissements_nationaux" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" "TypeEtablissement" NOT NULL DEFAULT 'HOPITAL_GENERAL',
    "ville" TEXT,
    "pays" TEXT DEFAULT 'Côte d''Ivoire',
    "contactEmail" TEXT,
    "contactTel" TEXT,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "apiKeyCreeeLe" TIMESTAMP(3),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etablissements_nationaux_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients_nationaux" (
    "id" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT,
    "genre" "Genre" NOT NULL,
    "dateNaissance" DATE NOT NULL,
    "contact" TEXT,
    "email" TEXT,
    "adresse" TEXT,
    "villeCommune" TEXT,
    "nationalite" TEXT,
    "profession" TEXT,
    "situationMatrimoniale" TEXT,
    "groupeSanguin" TEXT,
    "assuranceNom" TEXT,
    "assuranceNumero" TEXT,
    "etablissementOrigineId" TEXT,
    "versionSource" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_nationaux_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations_nationales" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "etablissementSourceId" TEXT NOT NULL,
    "referenceLocale" TEXT NOT NULL,
    "dateConsultation" TIMESTAMP(3) NOT NULL,
    "motif" TEXT NOT NULL,
    "professionnel" TEXT NOT NULL,
    "specialite" TEXT,
    "typeVisite" TEXT,
    "statut" "StatutConsultationNationale" NOT NULL DEFAULT 'TERMINEE',
    "diagnosticRetenu" TEXT,
    "codeCim10" TEXT,
    "syntheseClinique" TEXT,
    "conduiteATenir" TEXT,
    "publieLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultations_nationales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions_nationales" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "medicament" TEXT NOT NULL,
    "dci" TEXT,
    "dosage" TEXT,
    "posologie" TEXT,
    "voie" TEXT,
    "dureeJours" INTEGER,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_nationales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultats_examens_nationaux" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "categorie" TEXT,
    "valeur" TEXT,
    "unite" TEXT,
    "valeurNormale" TEXT,
    "interpretation" TEXT,
    "anormal" BOOLEAN,
    "dateResultat" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultats_examens_nationaux_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journaux_acces_national" (
    "id" TEXT NOT NULL,
    "etablissementId" TEXT,
    "patientId" TEXT,
    "matricule" TEXT,
    "action" "ActionNationale" NOT NULL,
    "ressource" TEXT,
    "succes" BOOLEAN NOT NULL DEFAULT true,
    "motifEchec" TEXT,
    "adresseIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journaux_acces_national_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etablissements_nationaux_code_key" ON "etablissements_nationaux"("code");

-- CreateIndex
CREATE UNIQUE INDEX "etablissements_nationaux_apiKeyHash_key" ON "etablissements_nationaux"("apiKeyHash");

-- CreateIndex
CREATE INDEX "etablissements_nationaux_actif_idx" ON "etablissements_nationaux"("actif");

-- CreateIndex
CREATE UNIQUE INDEX "patients_nationaux_matricule_key" ON "patients_nationaux"("matricule");

-- CreateIndex
CREATE INDEX "patients_nationaux_nom_prenom_idx" ON "patients_nationaux"("nom", "prenom");

-- CreateIndex
CREATE INDEX "patients_nationaux_etablissementOrigineId_idx" ON "patients_nationaux"("etablissementOrigineId");

-- CreateIndex
CREATE INDEX "consultations_nationales_patientId_dateConsultation_idx" ON "consultations_nationales"("patientId", "dateConsultation");

-- CreateIndex
CREATE INDEX "consultations_nationales_dateConsultation_idx" ON "consultations_nationales"("dateConsultation");

-- CreateIndex
CREATE UNIQUE INDEX "consultations_nationales_etablissementSourceId_referenceLoc_key" ON "consultations_nationales"("etablissementSourceId", "referenceLocale");

-- CreateIndex
CREATE INDEX "prescriptions_nationales_consultationId_idx" ON "prescriptions_nationales"("consultationId");

-- CreateIndex
CREATE INDEX "resultats_examens_nationaux_consultationId_idx" ON "resultats_examens_nationaux"("consultationId");

-- CreateIndex
CREATE INDEX "journaux_acces_national_etablissementId_idx" ON "journaux_acces_national"("etablissementId");

-- CreateIndex
CREATE INDEX "journaux_acces_national_patientId_idx" ON "journaux_acces_national"("patientId");

-- CreateIndex
CREATE INDEX "journaux_acces_national_matricule_idx" ON "journaux_acces_national"("matricule");

-- CreateIndex
CREATE INDEX "journaux_acces_national_createdAt_idx" ON "journaux_acces_national"("createdAt");

-- AddForeignKey
ALTER TABLE "patients_nationaux" ADD CONSTRAINT "patients_nationaux_etablissementOrigineId_fkey" FOREIGN KEY ("etablissementOrigineId") REFERENCES "etablissements_nationaux"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations_nationales" ADD CONSTRAINT "consultations_nationales_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients_nationaux"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations_nationales" ADD CONSTRAINT "consultations_nationales_etablissementSourceId_fkey" FOREIGN KEY ("etablissementSourceId") REFERENCES "etablissements_nationaux"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions_nationales" ADD CONSTRAINT "prescriptions_nationales_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultations_nationales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultats_examens_nationaux" ADD CONSTRAINT "resultats_examens_nationaux_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultations_nationales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journaux_acces_national" ADD CONSTRAINT "journaux_acces_national_etablissementId_fkey" FOREIGN KEY ("etablissementId") REFERENCES "etablissements_nationaux"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journaux_acces_national" ADD CONSTRAINT "journaux_acces_national_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients_nationaux"("id") ON DELETE SET NULL ON UPDATE CASCADE;
