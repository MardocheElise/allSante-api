import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { deriverCode, rendreUnique } from './code-etablissement';
import {
  PayloadInvalideError,
  validerConnexion,
  validerCreerCle,
  validerInscription,
  validerSystemes,
} from './dto/portail.dto';

/** Empreinte d'une clé API. Le clair n'est jamais stocké. */
export const empreinteDe = (cle: string) =>
  createHash('sha256').update(cle).digest('hex');

/**
 * Portail développeur d'All_Santé.
 *
 * Un établissement s'inscrit, obtient un code dérivé de son nom, puis génère
 * ses propres clés. Ce n'est pas du confort : c'est ce qui permet d'écrire
 * dans le journal « le CHR de Bouaké a ouvert ce dossier le 12 mars » et que
 * l'affirmation soit VRAIE. Une clé partagée entre tous les établissements
 * rendrait cette ligne d'audit décorative.
 */
@Injectable()
export class PortailService {
  private readonly logger = new Logger(PortailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ─── Inscription ───────────────────────────────────────────────────────────

  /**
   * Crée le compte développeur ET son établissement, dans une transaction.
   * Aucune clé n'est délivrée ici : le développeur la génère lui-même depuis
   * son tableau de bord, et elle ne s'affichera qu'une fois.
   */
  async inscrire(brut: unknown) {
    const dto = this.valider(() => validerInscription(brut));

    const dejaPris = await this.prisma.compteDeveloppeur.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (dejaPris) {
      throw new ConflictException(
        'Un compte existe déjà pour cette adresse e-mail',
      );
    }

    // Le code voyage dans chaque ligne d'audit : il doit rester lisible par
    // un humain qui relit la base des mois plus tard.
    const code = await rendreUnique(
      deriverCode(dto.nomEtablissement),
      async (candidat) =>
        (await this.prisma.etablissementNational.count({
          where: { code: candidat },
        })) > 0,
    );

    const motDePasseHash = await bcrypt.hash(dto.motDePasse, 12);

    const compte = await this.prisma.$transaction(async (tx) => {
      const etablissement = await tx.etablissementNational.create({
        data: {
          code,
          nom: dto.nomEtablissement,
          type: (dto.typeEtablissement as never) ?? 'HOPITAL_GENERAL',
          ville: dto.ville,
          contactEmail: dto.email,
          contactTel: dto.telephone,
          actif: true,
        },
      });

      return tx.compteDeveloppeur.create({
        data: {
          email: dto.email,
          motDePasseHash,
          nom: dto.nom,
          prenom: dto.prenom,
          telephone: dto.telephone,
          fonction: dto.fonction,
          etablissementId: etablissement.id,
        },
        include: { etablissement: true },
      });
    });

    this.logger.log(
      `Nouveau compte développeur : ${compte.email} → établissement ${code}`,
    );

    return {
      ok: true,
      jeton: await this.signerJeton(compte.id, compte.email, code),
      compte: this.versDTO(compte),
    };
  }

  // ─── Connexion ─────────────────────────────────────────────────────────────

  async connecter(brut: unknown) {
    const dto = this.valider(() => validerConnexion(brut));

    const compte = await this.prisma.compteDeveloppeur.findUnique({
      where: { email: dto.email },
      include: { etablissement: true },
    });

    // Message identique que le compte existe ou non : distinguer les deux
    // permettrait d'énumérer les adresses inscrites.
    const echec = new UnauthorizedException('Identifiants incorrects');
    if (!compte || !compte.actif) throw echec;

    const correspond = await bcrypt.compare(
      dto.motDePasse,
      compte.motDePasseHash,
    );
    if (!correspond) throw echec;

    await this.prisma.compteDeveloppeur.update({
      where: { id: compte.id },
      data: { derniereConnexion: new Date() },
    });

    return {
      ok: true,
      jeton: await this.signerJeton(
        compte.id,
        compte.email,
        compte.etablissement.code,
      ),
      compte: this.versDTO(compte),
    };
  }

  // ─── Clés API ──────────────────────────────────────────────────────────────

  /**
   * Génère une clé et la renvoie EN CLAIR — pour la seule et unique fois.
   * Seule son empreinte est conservée : perdue, une clé se remplace, elle ne
   * se retrouve pas.
   */
  async creerCle(compteId: string, brut: unknown) {
    const dto = this.valider(() => validerCreerCle(brut));
    const compte = await this.exigerCompte(compteId);

    // Format : als_<8 hex lisibles><32 hex secrets>. Le préfixe affichable
    // permet d'identifier une clé dans une liste sans jamais la révéler.
    const partieVisible = randomBytes(4).toString('hex');
    const partieSecrete = randomBytes(24).toString('hex');
    const cleEnClair = `als_${partieVisible}${partieSecrete}`;

    const cle = await this.prisma.cleApi.create({
      data: {
        etablissementId: compte.etablissementId,
        creeeParId: compte.id,
        libelle: dto.libelle,
        empreinte: empreinteDe(cleEnClair),
        prefixe: `als_${partieVisible}`,
      },
    });

    this.logger.log(
      `Clé API créée pour ${compte.etablissement.code} : ${cle.prefixe}… (${dto.libelle})`,
    );

    return {
      ok: true,
      /** Affichée une seule fois. Ne sera plus jamais consultable. */
      cle: cleEnClair,
      avertissement:
        "Copiez cette clé maintenant : elle ne sera plus jamais affichée. En cas de perte, révoquez-la et générez-en une nouvelle.",
      details: {
        id: cle.id,
        libelle: cle.libelle,
        prefixe: cle.prefixe,
        creeeLe: cle.createdAt.toISOString(),
        etablissement: compte.etablissement.code,
      },
    };
  }

  /** Liste les clés de l'établissement — préfixes seuls, jamais les clés. */
  async listerCles(compteId: string) {
    const compte = await this.exigerCompte(compteId);

    const cles = await this.prisma.cleApi.findMany({
      where: { etablissementId: compte.etablissementId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      etablissement: {
        code: compte.etablissement.code,
        nom: compte.etablissement.nom,
      },
      cles: cles.map((c) => ({
        id: c.id,
        libelle: c.libelle,
        prefixe: `${c.prefixe}…`,
        creeeLe: c.createdAt.toISOString(),
        dernierUsageLe: c.dernierUsageLe?.toISOString() ?? null,
        revoqueeLe: c.revoqueeLe?.toISOString() ?? null,
        active: c.revoqueeLe === null,
      })),
    };
  }

  /**
   * Révoque une clé. Irréversible, et immédiat : le prochain appel qui la
   * présente sera rejeté.
   */
  async revoquerCle(compteId: string, cleId: string, motif?: string) {
    const compte = await this.exigerCompte(compteId);

    const cle = await this.prisma.cleApi.findUnique({ where: { id: cleId } });
    if (!cle || cle.etablissementId !== compte.etablissementId) {
      // On ne confirme pas l'existence d'une clé appartenant à un autre
      // établissement : ce serait déjà une information.
      throw new NotFoundException('Clé introuvable');
    }
    if (cle.revoqueeLe) {
      return { ok: true, id: cle.id, message: 'Clé déjà révoquée' };
    }

    await this.prisma.cleApi.update({
      where: { id: cle.id },
      data: {
        revoqueeLe: new Date(),
        motifRevocation: motif ?? 'Révocation depuis le portail',
      },
    });

    this.logger.warn(
      `Clé révoquée pour ${compte.etablissement.code} : ${cle.prefixe}…`,
    );

    return {
      ok: true,
      id: cle.id,
      message: 'Clé révoquée. Tout appel la présentant sera désormais rejeté.',
    };
  }

  /** Profil du compte connecté, pour le tableau de bord. */
  async profil(compteId: string) {
    const compte = await this.exigerCompte(compteId);
    return this.versDTO(compte);
  }

  // ─── Systèmes de l'établissement ───────────────────────────────────────────

  /**
   * Adresses vers lesquelles All_Santé renvoie les Bundles FHIR de cet
   * établissement. La clé sortante n'est jamais renvoyée en clair : le
   * développeur sait seulement si elle est définie.
   */
  async lireSystemes(compteId: string) {
    const compte = await this.exigerCompte(compteId);
    const e = compte.etablissement;
    return {
      code: e.code,
      dpiUrl: e.dpiUrl,
      openelisUrl: e.openelisUrl,
      cleSortanteDefinie: !!e.cleSortante,
      complet: !!e.dpiUrl && !!e.openelisUrl && !!e.cleSortante,
    };
  }

  /**
   * Déclare les systèmes de l'établissement.
   *
   * Tant qu'ils ne sont pas renseignés, le bus retombe sur les cibles globales
   * de sa configuration — c'est-à-dire vers un AUTRE hôpital dès qu'il y en a
   * plus d'un. C'est la raison d'être de cet écran.
   */
  async majSystemes(compteId: string, brut: unknown) {
    const dto = this.valider(() => validerSystemes(brut));
    const compte = await this.exigerCompte(compteId);

    const e = await this.prisma.etablissementNational.update({
      where: { id: compte.etablissementId },
      data: {
        dpiUrl: dto.dpiUrl,
        openelisUrl: dto.openelisUrl,
        // Une clé absente du payload ne doit pas effacer celle déjà en place.
        ...(dto.cleSortante ? { cleSortante: dto.cleSortante } : {}),
      },
      select: {
        code: true,
        dpiUrl: true,
        openelisUrl: true,
        cleSortante: true,
      },
    });

    this.logger.log(
      `Systèmes déclarés pour ${e.code} : DPI=${e.dpiUrl ?? '—'} OpenELIS=${e.openelisUrl ?? '—'}`,
    );

    return {
      ok: true,
      code: e.code,
      dpiUrl: e.dpiUrl,
      openelisUrl: e.openelisUrl,
      cleSortanteDefinie: !!e.cleSortante,
      message:
        'Les Bundles FHIR de votre établissement seront désormais routés vers ces adresses.',
    };
  }

  // ─── Aides internes ────────────────────────────────────────────────────────

  private async exigerCompte(compteId: string) {
    const compte = await this.prisma.compteDeveloppeur.findUnique({
      where: { id: compteId },
      include: { etablissement: true },
    });
    if (!compte || !compte.actif) {
      throw new UnauthorizedException('Compte introuvable ou désactivé');
    }
    return compte;
  }

  private signerJeton(id: string, email: string, codeEtablissement: string) {
    return this.jwt.signAsync({ sub: id, email, etab: codeEtablissement });
  }

  private versDTO(compte: {
    id: string;
    email: string;
    nom: string;
    prenom: string | null;
    fonction: string | null;
    etablissement: { code: string; nom: string; ville: string | null };
  }) {
    return {
      id: compte.id,
      email: compte.email,
      nom: compte.nom,
      prenom: compte.prenom,
      fonction: compte.fonction,
      etablissement: {
        code: compte.etablissement.code,
        nom: compte.etablissement.nom,
        ville: compte.etablissement.ville,
      },
    };
  }

  private valider<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof PayloadInvalideError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
