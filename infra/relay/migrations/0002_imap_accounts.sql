ALTER TABLE `linked_accounts` ADD `provider` text DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE `linked_accounts` ADD `imap` text;