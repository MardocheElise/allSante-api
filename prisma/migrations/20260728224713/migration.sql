-- CreateEnum
CREATE TYPE "EtagePartage" AS ENUM ('SOCLE_VITAL', 'EPISODE_SOIN', 'CHARGE_SOCIALE');

-- CreateEnum
CREATE TYPE "PorteeConsentement" AS ENUM ('CONSULTATION_UNIQUE', 'DURABLE');

-- CreateEnum
CREATE TYPE "SupportConsentement" AS ENUM ('ORAL_TRACE_DPI', 'FORMULAIRE_PAPIER', 'SMS', 'PORTAIL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionNationale" ADD VALUE 'LECTURE_SOCLE_VITAL';
ALTER TYPE "ActionNationale" ADD VALUE 'PUBLICATION_SOCLE_VITAL';
ALTER TYPE "ActionNationale" ADD VALUE 'REFUS_SANS_CONSENTEMENT';
ALTER TYPE "ActionNationale" ADD VALUE 'REVOCATION_CONSULTATION';
ALTER TYPE "ActionNationale" ADD VALUE 'MAJ_PREFERENCES_PARTAGE';

-- AlterTable
ALTER TABLE "consultations_nationales" ADD COLUMN     "etage" "EtagePartage" NOT NULL DEFAULT 'EPISODE_SOIN',
ADD COLUMN     "motifRevocation" TEXT,
ADD COLUMN     "partage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revoqueeLe" TIMESTAMP(3),
ALTER COLUMN "dateConsultation" DROP NOT NULL,
ALTER COLUMN "motif" DROP NOT NULL,
ALTER COLUMN "professionnel" DROP NOT NULL;

-- AlterTable
ALTER TABLE "patients_nationaux" ADD COLUMN     "oppositionSocleVital" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "oppositionSocleVitalLe" TIMESTAMP(3),
ADD COLUMN     "partageDurable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "partageDurableDepuis" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "consentements_publication" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT,
    "etablissementId" TEXT,
    "accorde" BOOLEAN NOT NULL,
    "portee" "PorteeConsentement" NOT NULL DEFAULT 'CONSULTATION_UNIQUE',
    "support" "SupportConsentement" NOT NULL DEFAULT 'ORAL_TRACE_DPI',
    "etages" "EtagePartage"[],
    "recueilliPar" TEXT NOT NULL,
    "recueilliLe" TIMESTAMP(3) NOT NULL,
    "preuve" TEXT,
    "revoqueLe" TIMESTAMP(3),
    "revoquePar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentements_publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergies_nationales" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "etablissementSourceId" TEXT NOT NULL,
    "referenceLocale" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "type" TEXT,
    "severite" TEXT,
    "reaction" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "declareeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allergies_nationales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traitements_chroniques_nationaux" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "etablissementSourceId" TEXT NOT NULL,
    "referenceLocale" TEXT NOT NULL,
    "medicament" TEXT NOT NULL,
    "dci" TEXT,
    "dosage" TEXT,
    "posologie" TEXT,
    "indication" TEXT,
    "debutLe" TIMESTAMP(3),
    "finLe" TIMESTAMP(3),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "declareLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "traitements_chroniques_nationaux_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consentements_publication_patientId_createdAt_idx" ON "consentements_publication"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "consentements_publication_consultationId_idx" ON "consentements_publication"("consultationId");

-- CreateIndex
CREATE INDEX "allergies_nationales_patientId_active_idx" ON "allergies_nationales"("patientId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "allergies_nationales_etablissementSourceId_referenceLocale_key" ON "allergies_nationales"("etablissementSourceId", "referenceLocale");

-- CreateIndex
CREATE INDEX "traitements_chroniques_nationaux_patientId_actif_idx" ON "traitements_chroniques_nationaux"("patientId", "actif");

-- CreateIndex
CREATE UNIQUE INDEX "traitements_chroniques_nationaux_etablissementSourceId_refe_key" ON "traitements_chroniques_nationaux"("etablissementSourceId", "referenceLocale");

-- CreateIndex
CREATE INDEX "consultations_nationales_patientId_partage_idx" ON "consultations_nationales"("patientId", "partage");

-- AddForeignKey
ALTER TABLE "consentements_publication" ADD CONSTRAINT "consentements_publication_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients_nationaux"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentements_publication" ADD CONSTRAINT "consentements_publication_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultations_nationales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies_nationales" ADD CONSTRAINT "allergies_nationales_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients_nationaux"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traitements_chroniques_nationaux" ADD CONSTRAINT "traitements_chroniques_nationaux_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients_nationaux"("id") ON DELETE CASCADE ON UPDATE CASCADE;
