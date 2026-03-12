-- Rename cash_out column to take_profit_amount on virtual_bets
ALTER TABLE "virtual_bets" RENAME COLUMN "cash_out" TO "take_profit_amount";

