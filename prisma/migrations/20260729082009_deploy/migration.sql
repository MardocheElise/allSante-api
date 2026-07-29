/*
  Warnings:

  - You are about to drop the column `apiKeyCreeeLe` on the `etablissements_nationaux` table. All the data in the column will be lost.
  - You are about to drop the column `apiKeyHash` on the `etablissements_nationaux` table. All the data in the column will be lost.
  - You are about to drop the column `apiKeyPrefix` on the `etablissements_nationaux` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "etablissements_nationaux_apiKeyHash_key";

-- AlterTable
ALTER TABLE "etablissements_nationaux" DROP COLUMN "apiKeyCreeeLe",
DROP COLUMN "apiKeyHash",
DROP COLUMN "apiKeyPrefix";

-- CreateTable
CREATE TABLE "comptes_developpeurs" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "motDePasseHash" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT,
    "telephone" TEXT,
    "fonction" TEXT,
    "etablissementId" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "derniereConnexion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comptes_developpeurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cles_api" (
    "id" TEXT NOT NULL,
    "etablissementId" TEXT NOT NULL,
    "creeeParId" TEXT,
    "libelle" TEXT NOT NULL,
    "empreinte" TEXT NOT NULL,
    "prefixe" TEXT NOT NULL,
    "dernierUsageLe" TIMESTAMP(3),
    "revoqueeLe" TIMESTAMP(3),
    "motifRevocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cles_api_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comptes_developpeurs_email_key" ON "comptes_developpeurs"("email");

-- CreateIndex
CREATE INDEX "comptes_developpeurs_etablissementId_idx" ON "comptes_developpeurs"("etablissementId");

-- CreateIndex
CREATE UNIQUE INDEX "cles_api_empreinte_key" ON "cles_api"("empreinte");

-- CreateIndex
CREATE INDEX "cles_api_etablissementId_revoqueeLe_idx" ON "cles_api"("etablissementId", "revoqueeLe");

-- AddForeignKey
ALTER TABLE "comptes_developpeurs" ADD CONSTRAINT "comptes_developpeurs_etablissementId_fkey" FOREIGN KEY ("etablissementId") REFERENCES "etablissements_nationaux"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cles_api" ADD CONSTRAINT "cles_api_etablissementId_fkey" FOREIGN KEY ("etablissementId") REFERENCES "etablissements_nationaux"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cles_api" ADD CONSTRAINT "cles_api_creeeParId_fkey" FOREIGN KEY ("creeeParId") REFERENCES "comptes_developpeurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
