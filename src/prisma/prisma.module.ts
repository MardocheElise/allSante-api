import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Connexion au dépôt national, partagée par toute l'application. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
