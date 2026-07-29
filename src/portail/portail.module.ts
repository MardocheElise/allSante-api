import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CompteGuard } from './compte.guard';
import { PortailController } from './portail.controller';
import { PortailService } from './portail.service';

/**
 * Portail développeur : c'est par lui qu'un établissement obtient l'identité
 * qu'il prouvera ensuite à chaque appel du dépôt national.
 */
@Module({
  imports: [
    JwtModule.register({
      secret:
        process.env.PORTAIL_JWT_SECRET ??
        'portail-dev-secret-a-changer-en-production',
      signOptions: { expiresIn: process.env.PORTAIL_JWT_EXPIRES ?? '12h' },
    }),
  ],
  controllers: [PortailController],
  providers: [PortailService, CompteGuard],
  exports: [PortailService],
})
export class PortailModule {}
