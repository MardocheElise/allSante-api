// ─────────────────────────────────────────────────────────────────────────────
// Interopérabilité — Contrat FHIR R4 (réception DPI, côté consommateur)
//
// Le DPI reçoit de SGCH un Bundle FHIR (Patient + Invoice) décrivant une prise
// en charge réglée en caisse. Ce module valide le Bundle et en extrait les
// données métier nécessaires à la matérialisation locale (patient miroir +
// fiche réglée). La clé pivot est le matricule CMU porté par l'identifiant
// FHIR `identifier.system = SYSTEME_CMU`.
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEME_CMU = 'https://interop.sante.ci/cmu/matricule';
export const SYSTEME_REFERENCE_FICHE = 'https://sgch.sante.ci/fiche/reference';
export const SYSTEME_NUMERO_RECU = 'https://sgch.sante.ci/fiche/numero-recu';

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

// ── Données extraites (prêtes à persister côté DPI) ─────────────────────────
export interface PatientExtrait {
  matriculeCMU: string;
  code: string;
  nom: string;
  prenom: string | null;
  genre: 'masculin' | 'feminin';
  dateNaissance: string; // YYYY-MM-DD
  contact: string;
  email: string | null;
}

export interface PrestationExtraite {
  prestation: string;
  montantActe: number;
  qte: number;
  montantTotal: number;
}

export interface FicheExtraite {
  reference: string;
  numeroRecu: string;
  service: string;
  caissier: string;
  sexe: 'M' | 'F';
  age: number;
  aPayer: number;
  codePatient: string;
  prestations: PrestationExtraite[];
}

export interface PriseEnChargeExtraite {
  patient: PatientExtrait;
  fiche: FicheExtraite;
}

export class BundleInvalideError extends Error {}

function findIdentifier(
  identifiers: FhirIdentifier[] | undefined,
  system: string,
): string | undefined {
  return identifiers?.find((i) => i.system === system)?.value;
}

function getExt(
  extensions:
    | Array<{ url?: string; valueString?: string; valueInteger?: number }>
    | undefined,
  url: string,
): { valueString?: string; valueInteger?: number } | undefined {
  return extensions?.find((e) => e.url === url);
}

/**
 * Valide un Bundle FHIR de prise en charge et en extrait les données métier.
 * @throws BundleInvalideError si le Bundle est mal formé ou incomplet.
 */
export function extrairePriseEnCharge(
  bundle: FhirBundleLike,
): PriseEnChargeExtraite {
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

  const patientRes = resources.find((r) => r.resourceType === 'Patient');
  const invoiceRes = resources.find((r) => r.resourceType === 'Invoice');

  if (!patientRes) throw new BundleInvalideError('Ressource Patient absente');
  if (!invoiceRes) throw new BundleInvalideError('Ressource Invoice absente');

  // ── Patient
  const pIdentifiers = patientRes.identifier as FhirIdentifier[] | undefined;
  const matriculeCMU = findIdentifier(pIdentifiers, SYSTEME_CMU);
  if (!matriculeCMU) {
    throw new BundleInvalideError(
      'Matricule CMU (clé pivot) absent du Patient',
    );
  }

  const names = patientRes.name as
    | { family?: string; given?: string[] }[]
    | undefined;
  const nom = names?.[0]?.family ?? '';
  const prenom = names?.[0]?.given?.[0] ?? null;
  const gender = patientRes.gender as string | undefined;
  const genre: 'masculin' | 'feminin' =
    gender === 'female' ? 'feminin' : 'masculin';
  const birthDate =
    (patientRes.birthDate as string | undefined) ?? '1970-01-01';

  const telecom = patientRes.telecom as
    | { system?: string; value?: string }[]
    | undefined;
  const contact = telecom?.find((t) => t.system === 'phone')?.value ?? '';
  const email = telecom?.find((t) => t.system === 'email')?.value ?? null;

  // ── Invoice (fiche de paiement)
  const iIdentifiers = invoiceRes.identifier as FhirIdentifier[] | undefined;
  const reference = findIdentifier(iIdentifiers, SYSTEME_REFERENCE_FICHE);
  const numeroRecu = findIdentifier(iIdentifiers, SYSTEME_NUMERO_RECU) ?? '';
  if (!reference) {
    throw new BundleInvalideError('Référence de fiche absente de l’Invoice');
  }

  const ext = invoiceRes.extension as
    | Array<{ url?: string; valueString?: string; valueInteger?: number }>
    | undefined;
  const service = getExt(ext, 'service')?.valueString ?? 'Non précisé';
  const caissier = getExt(ext, 'caissier')?.valueString ?? 'Système';
  const sexe: 'M' | 'F' = getExt(ext, 'sexe')?.valueString === 'F' ? 'F' : 'M';
  const age = getExt(ext, 'age')?.valueInteger ?? 0;
  const codePatient = getExt(ext, 'codePatient')?.valueString ?? matriculeCMU;

  const totalGross = invoiceRes.totalGross as { value?: number } | undefined;
  const aPayer = totalGross?.value ?? 0;

  const lineItems = invoiceRes.lineItem as
    | Array<{
        chargeItemCodeableConcept?: { text?: string };
        priceComponent?: {
          amount?: { value?: number };
          factor?: number;
        }[];
      }>
    | undefined;

  const prestations: PrestationExtraite[] = (lineItems ?? []).map((li) => {
    const montantActe = li.priceComponent?.[0]?.amount?.value ?? 0;
    const qte = li.priceComponent?.[0]?.factor ?? 1;
    return {
      prestation: li.chargeItemCodeableConcept?.text ?? 'Prestation',
      montantActe,
      qte,
      montantTotal: montantActe * qte,
    };
  });

  return {
    patient: {
      matriculeCMU,
      code: codePatient,
      nom,
      prenom,
      genre,
      dateNaissance: birthDate,
      contact,
      email,
    },
    fiche: {
      reference,
      numeroRecu,
      service,
      caissier,
      sexe,
      age,
      aPayer,
      codePatient,
      prestations,
    },
  };
}
