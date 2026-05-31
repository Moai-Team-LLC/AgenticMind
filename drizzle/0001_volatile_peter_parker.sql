ALTER TABLE "answer_cache" ALTER COLUMN "question_embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "ask_clusters" ALTER COLUMN "centroid_embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "beliefs" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "knowledge_cards" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);