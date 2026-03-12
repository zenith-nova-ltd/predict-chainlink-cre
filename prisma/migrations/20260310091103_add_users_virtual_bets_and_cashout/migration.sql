/*
  Warnings:

  - Added the required column `user_id` to the `predictions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'CANCELLED', 'CASHED_OUT');

-- AlterTable
ALTER TABLE "predictions" ADD COLUMN     "user_id" TEXT NOT NULL,
ALTER COLUMN "clob_token_ids" DROP NOT NULL,
ALTER COLUMN "clob_token_ids" DROP DEFAULT;

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 10000.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_bets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "market_slug" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "outcome_price" DOUBLE PRECISION NOT NULL,
    "potential_payout" DOUBLE PRECISION NOT NULL,
    "status" "BetStatus" NOT NULL DEFAULT 'PENDING',
    "pnl" DOUBLE PRECISION,
    "settled_at" TIMESTAMP(3),
    "exit_outcome_price" DOUBLE PRECISION,
    "cash_out" DOUBLE PRECISION,
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "take_profit_pct" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_bets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_bets" ADD CONSTRAINT "virtual_bets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_bets" ADD CONSTRAINT "virtual_bets_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
