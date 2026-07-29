// ─────────────────────────────────────────────────────────────────────────────
// Contrat FHIR R4 — validation d'un Bundle « demande d'examen » (DPI → OpenELIS)
//
// Le builder canonique vit dans fhir-demande.ts (réutilisé tel quel depuis le
// DPI). Côté HUB, AllSanté ne construit pas le Bundle : il le REÇOIT du DPI et
// doit le valider avant de le router vers OpenELIS. Ce module fournit cette
// validation légère + un résumé d'audit, sans dépendance externe.
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEME_CMU = 'https://interop.sante.ci/cmu/matricule';
const SYSTEME_NUMERO_DEMANDE = 'https://dpi.sante.ci/demande-examen/numero';

interface FhirIdentifier {
  system?: string;
  value?: string;
}
interface FhirResource {
  resourceType?: string;
  [k: string]: unknown;
}
interface FhirBundleLike {
  resourceType?: string;
  entry?: { resource?: FhirResource }[];
}

export class BundleInvalideError extends Error {}

export interface DemandeExamenResume {
  matriculeCMU: string;
  numerosDemande: string[];
}

function findIdentifier(
  ids: FhirIdentifier[] | undefined,
  system: string,
): string | undefined {
  return ids?.find((i) => i.system === system)?.value;
}

/**
 * Valide un Bundle FHIR de demande d'examen et en extrait un résumé d'audit.
 * @throws BundleInvalideError si le Bundle est mal formé ou incomplet.
 */
export function validerDemandeExamen(
  bundle: FhirBundleLike,
): DemandeExamenResume {
  if (
    !bundle ||
    bundle.resourceType !== 'Bundle' ||
    !Array.isArray(bundle.entry)
  ) {
    throw new BundleInvalideError('Bundle FHIR invalide ou vide');
  }

  const resources = bundle.entry
    .map((e) => e.resource)
    .filter((r): r is FhirResource => !!r);

  const patient = resources.find((r) => r.resourceType === 'Patient');
  if (!patient) throw new BundleInvalideError('Ressource Patient absente');

  const matriculeCMU = findIdentifier(
    patient.identifier as FhirIdentifier[] | undefined,
    SYSTEME_CMU,
  );
  if (!matriculeCMU) {
    throw new BundleInvalideError('Matricule CMU (clé pivot) absent du Patient');
  }

  const services = resources.filter(
    (r) => r.resourceType === 'ServiceRequest',
  );
  if (services.length === 0) {
    throw new BundleInvalideError('Aucune ServiceRequest dans le Bundle');
  }

  const numerosDemande = services
    .map((s) =>
      findIdentifier(s.identifier as FhirIdentifier[] | undefined, SYSTEME_NUMERO_DEMANDE),
    )
    .filter((n): n is string => !!n);

  if (numerosDemande.length === 0) {
    throw new BundleInvalideError('numeroDemande absent des ServiceRequest');
  }

  return { matriculeCMU, numerosDemande };
}
