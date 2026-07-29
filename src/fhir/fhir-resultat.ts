// ─────────────────────────────────────────────────────────────────────────────
// Interopérabilité — Contrat FHIR R4 (réception DPI) : résultats d'examen
//
// Le DPI reçoit d'OpenELIS un Bundle FHIR (DiagnosticReport + Observation)
// contenant les résultats validés d'une demande, identifiée par le
// `numeroDemande` partagé. Ce module valide le Bundle et en extrait les
// résultats pour les rattacher à la DemandeExamen locale.
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEME_CMU = 'https://interop.sante.ci/cmu/matricule';
export const SYSTEME_NUMERO_DEMANDE =
  'https://dpi.sante.ci/demande-examen/numero';

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

export interface ResultatExtrait {
  parametre: string;
  valeur: string;
  unite: string | null;
  referenceMin: number | null;
  referenceMax: number | null;
  interpretation: string | null;
  valideePar: string | null;
}

export interface ResultatsExtraits {
  matriculeCMU: string;
  numeroDemande: string;
  resultats: ResultatExtrait[];
}

export class BundleInvalideError extends Error {}

function findIdentifier(
  ids: FhirIdentifier[] | undefined,
  system: string,
): string | undefined {
  return ids?.find((i) => i.system === system)?.value;
}

/**
 * Valide un Bundle FHIR de résultats et en extrait les données métier.
 * @throws BundleInvalideError si le Bundle est mal formé ou incomplet.
 */
export function extraireResultats(bundle: FhirBundleLike): ResultatsExtraits {
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

  const report = resources.find((r) => r.resourceType === 'DiagnosticReport');
  const observations = resources.filter(
    (r) => r.resourceType === 'Observation',
  );

  if (!report) {
    throw new BundleInvalideError('Ressource DiagnosticReport absente');
  }

  const numeroDemande = findIdentifier(
    report.identifier as FhirIdentifier[] | undefined,
    SYSTEME_NUMERO_DEMANDE,
  );
  if (!numeroDemande) {
    throw new BundleInvalideError('numeroDemande absent du DiagnosticReport');
  }

  const subject = report.subject as { identifier?: FhirIdentifier } | undefined;
  const matriculeCMU =
    subject?.identifier?.system === SYSTEME_CMU
      ? (subject.identifier.value ?? '')
      : '';

  const resultats: ResultatExtrait[] = observations.map((o) => {
    const code = o.code as { text?: string } | undefined;
    const ext = o.extension as
      | { url?: string; valueString?: string; valueDecimal?: number }[]
      | undefined;
    const getS = (url: string) =>
      ext?.find((e) => e.url === url)?.valueString ?? null;
    const getN = (url: string) => {
      const v = ext?.find((e) => e.url === url)?.valueDecimal;
      return v === undefined ? null : v;
    };
    return {
      parametre: code?.text ?? 'Paramètre',
      valeur: (o.valueString as string | undefined) ?? '',
      unite: getS('unite'),
      referenceMin: getN('referenceMin'),
      referenceMax: getN('referenceMax'),
      interpretation: getS('interpretation'),
      valideePar: getS('valideePar'),
    };
  });

  return { matriculeCMU, numeroDemande, resultats };
}
