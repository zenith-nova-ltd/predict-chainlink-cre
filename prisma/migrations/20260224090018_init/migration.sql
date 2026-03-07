-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('UP', 'DOWN', 'NO_BET');

-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_price" DOUBLE PRECISION,
    "market_slug" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL,
    "outcome_prices" JSONB NOT NULL,
    "direction" "Direction" NOT NULL,
    "size_usd" DOUBLE PRECISION NOT NULL,
    "max_loss_usd" DOUBLE PRECISION NOT NULL,
    "edge_prob" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);
