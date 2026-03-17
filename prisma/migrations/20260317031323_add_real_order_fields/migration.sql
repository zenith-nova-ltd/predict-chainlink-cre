/*
  Warnings:

  - The values [TAKE_PROFIT] on the enum `BetStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "BetStatus_new" AS ENUM ('PENDING', 'WON', 'LOST', 'CANCELLED');
ALTER TABLE "public"."virtual_bets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "virtual_bets" ALTER COLUMN "status" TYPE "BetStatus_new" USING ("status"::text::"BetStatus_new");
ALTER TYPE "BetStatus" RENAME TO "BetStatus_old";
ALTER TYPE "BetStatus_new" RENAME TO "BetStatus";
DROP TYPE "public"."BetStatus_old";
ALTER TABLE "virtual_bets" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "virtual_bets" ADD COLUMN     "clob_order_id" TEXT,
ADD COLUMN     "clob_shares" DOUBLE PRECISION,
ADD COLUMN     "clob_token_id" TEXT,
ADD COLUMN     "is_real" BOOLEAN NOT NULL DEFAULT false;
