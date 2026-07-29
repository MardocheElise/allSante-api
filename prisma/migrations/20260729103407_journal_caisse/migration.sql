-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionNationale" ADD VALUE 'ROUTAGE_PRISE_EN_CHARGE';
ALTER TYPE "ActionNationale" ADD VALUE 'ROUTAGE_DEMANDE_EXAMEN';
ALTER TYPE "ActionNationale" ADD VALUE 'ROUTAGE_RESULTATS';
