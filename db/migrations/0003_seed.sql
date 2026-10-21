-- Profile row and the two default templates (v1 seeded these on first start).
INSERT INTO "profile" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "email_templates" ("name", "kind", "subject", "body") VALUES
  ('Intro: coffee chat', 'initial', 'Waterloo student interested in {company}', 'Hi {first_name},

[[hook: one specific line on why I''m reaching out to this person - shared school, their post, their team''s work]]

I''m a {my_program} student at Waterloo looking at {target_role} roles. [[why_company: one sentence on why {company}, using company notes and news]]

Would you be open to a 15-minute chat in the next couple of weeks?

Best,
{my_name}'),
  ('Follow-up: gentle nudge', 'followup', 'Re: Waterloo student interested in {company}', 'Hi {first_name},

[[nudge: one or two friendly sentences that add something new - a recent {company} update or a short reason I''m still keen - without guilt-tripping]]

Happy to work around your schedule if a quick chat is possible.

Best,
{my_name}');
