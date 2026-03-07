-- AlterTable
ALTER TABLE "predictions" ADD COLUMN     "clob_token_ids" JSONB NOT NULL DEFAULT '[]';
