CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_hash_unique` ON `agent_tokens` (`hash`);--> statement-breakpoint
CREATE INDEX `agent_tokens_user` ON `agent_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_links` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_threads` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`thread_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`, `email`, `thread_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`settled_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
