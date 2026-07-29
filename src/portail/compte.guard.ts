import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface RequeteAvecCompte extends Request {
  compteId?: string;
}

/**
 * Authentifie un développeur du portail par jeton JWT (en-tête
 * `Authorization: Bearer …`).
 *
 * À ne pas confondre avec `ApiKeyGuard` : celle-ci protège le PORTAIL (le
 * développeur qui gère ses clés depuis le site), l'autre protège le DÉPÔT
 * NATIONAL (le logiciel hospitalier qui appelle l'API avec une clé).
 */
@Injectable()
export class CompteGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requete = context.switchToHttp().getRequest<RequeteAvecCompte>();
    const entete = requete.headers.authorization;

    if (!entete?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Jeton de session manquant');
    }

    try {
      const charge = await this.jwt.verifyAsync<{ sub: string }>(
        entete.slice(7),
      );
      requete.compteId = charge.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Session expirée ou jeton invalide');
    }
  }
}
