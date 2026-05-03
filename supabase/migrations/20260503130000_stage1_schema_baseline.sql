create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: handle_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: insert_default_options(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_default_options(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if exists (
    select 1
    from public.user_options
    where user_id = p_user_id
      and field_name = 'content_category'
  ) then
    return;
  end if;

  insert into public.user_options (user_id, field_name, option_value, sort_order)
  values
    (p_user_id, 'content_category', '工作', 0),
    (p_user_id, 'content_category', '家庭', 1),
    (p_user_id, 'content_category', '恋爱与亲密关系', 2),
    (p_user_id, 'content_category', '个人成长', 3),
    (p_user_id, 'content_category', '学习', 4),
    (p_user_id, 'content_category', '财务', 5),
    (p_user_id, 'content_category', '运动健康', 6),
    (p_user_id, 'content_category', '社交', 7),
    (p_user_id, 'content_category', '玩乐休闲', 8),
    (p_user_id, 'content_category', '灵性修行', 9),
    (p_user_id, 'content_category', '日常生活', 10);
end;
$$;


--
-- Name: replace_category_tag(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_category_tag(p_old text, p_new text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    AS $$
  UPDATE journal_entries
  SET category_tags = array_replace(category_tags, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(category_tags);
$$;


--
-- Name: replace_core_need(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_core_need(p_old text, p_new text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE journal_entries
  SET core_needs = array_replace(core_needs, p_old, p_new)
  WHERE user_id = auth.uid()
    AND core_needs @> ARRAY[p_old];
END;
$$;


--
-- Name: replace_person_name(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_person_name(p_old text, p_new text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE journal_entries
  SET people_involved = array_replace(people_involved, p_old, p_new)
  WHERE user_id = auth.uid()
    AND people_involved @> ARRAY[p_old];
END;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: trigger_insert_default_options(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_insert_default_options() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.insert_default_options(new.id);
  return new;
end;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entry_id uuid,
    letter_id uuid,
    context_type text NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT conversations_context_type_check CHECK ((context_type = ANY (ARRAY['entry'::text, 'letter'::text])))
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    template_type text DEFAULT 'free'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category_tags text[] DEFAULT '{}'::text[],
    event_thread text,
    people_involved text[] DEFAULT '{}'::text[],
    physical_state text,
    sleep_quality smallint,
    sleep_notes text,
    overall_state_score smallint,
    body_sensations text,
    current_thought text,
    core_needs text[] DEFAULT '{}'::text[],
    core_needs_exploration text,
    current_behavior text,
    handling_rating text,
    handling_improvement text,
    acceptance_level text,
    acceptance_notes text,
    cognitive_distortion_type text,
    cognitive_analysis text,
    reflection_insight text,
    gratitude_target text,
    gratitude_reason text,
    gratitude_feeling text,
    learning_source text,
    key_insights text,
    my_understanding text,
    action_intent text,
    remaining_questions text,
    idea_title text,
    idea_trigger text,
    next_action text,
    decision_options text,
    decision_made text,
    decision_emotion text,
    decision_reasoning text,
    decision_outcome text,
    decision_retrospect_rating text,
    decision_retrospect_notes text,
    event_name text,
    emotions text[],
    deleted_at timestamp with time zone,
    sync_status text DEFAULT 'synced'::text,
    emotion_display text[] DEFAULT '{}'::text[],
    emotion_confidence double precision,
    attachments jsonb DEFAULT '[]'::jsonb,
    entry_summary text,
    theme_hints text[],
    covered_by_letter_id uuid,
    image_urls text[] DEFAULT '{}'::text[],
    annotations jsonb,
    CONSTRAINT journal_entries_overall_state_score_check CHECK (((overall_state_score >= '-5'::integer) AND (overall_state_score <= 5))),
    CONSTRAINT journal_entries_sleep_quality_check CHECK (((sleep_quality >= 1) AND (sleep_quality <= 5))),
    CONSTRAINT journal_entries_template_type_check CHECK ((template_type = ANY (ARRAY['awareness'::text, 'gratitude'::text, 'learning'::text, 'freewrite'::text, 'action'::text, 'emotion'::text, 'free'::text])))
);


--
-- Name: pending_core_needs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_core_needs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    proposed text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: review_letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_letters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entry_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    content text NOT NULL,
    insights jsonb DEFAULT '{}'::jsonb,
    trigger_type text,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    is_read boolean DEFAULT false,
    user_response text,
    created_at timestamp with time zone DEFAULT now(),
    annotations jsonb,
    CONSTRAINT review_letters_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['count'::text, 'days'::text, 'manual'::text])))
);


--
-- Name: thread_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_entries (
    thread_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now(),
    added_by text NOT NULL,
    removed_by_user boolean DEFAULT false NOT NULL,
    CONSTRAINT thread_entries_added_by_check CHECK ((added_by = ANY (ARRAY['ai'::text, 'user'::text])))
);


--
-- Name: threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    arc_summary text,
    arc_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    trigger_source text,
    review_letter_id uuid,
    fragments jsonb,
    current_state text,
    analysis_generated_at timestamp with time zone,
    current_state_annotations jsonb,
    CONSTRAINT threads_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'confirmed'::text, 'archived'::text, 'rejected'::text])))
);


--
-- Name: user_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    canonical text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    group_name text
);


--
-- Name: user_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_memory (
    user_id uuid NOT NULL,
    rolling_summary text,
    user_profile text,
    updated_at timestamp with time zone DEFAULT now(),
    conversation_count integer DEFAULT 0 NOT NULL
);


--
-- Name: user_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    field_name text NOT NULL,
    option_value text NOT NULL,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    is_default boolean DEFAULT false
);


--
-- Name: conversations conversations_entry_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_entry_unique UNIQUE (entry_id, context_type);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: pending_core_needs pending_core_needs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_core_needs
    ADD CONSTRAINT pending_core_needs_pkey PRIMARY KEY (id);


--
-- Name: review_letters review_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_letters
    ADD CONSTRAINT review_letters_pkey PRIMARY KEY (id);


--
-- Name: thread_entries thread_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_entries
    ADD CONSTRAINT thread_entries_pkey PRIMARY KEY (thread_id, entry_id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: user_contacts user_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contacts
    ADD CONSTRAINT user_contacts_pkey PRIMARY KEY (id);


--
-- Name: user_memory user_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_pkey PRIMARY KEY (user_id);


--
-- Name: user_options user_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_options
    ADD CONSTRAINT user_options_pkey PRIMARY KEY (id);


--
-- Name: user_options user_options_user_id_field_name_option_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_options
    ADD CONSTRAINT user_options_user_id_field_name_option_value_key UNIQUE (user_id, field_name, option_value);


--
-- Name: idx_journal_entries_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_created_at ON public.journal_entries USING btree (created_at DESC);


--
-- Name: idx_journal_entries_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_user_id ON public.journal_entries USING btree (user_id);


--
-- Name: journal_entries journal_entries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER journal_entries_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: journal_entries set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: conversations conversations_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_letter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_letter_id_fkey FOREIGN KEY (letter_id) REFERENCES public.review_letters(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: journal_entries journal_entries_covered_by_letter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_covered_by_letter_id_fkey FOREIGN KEY (covered_by_letter_id) REFERENCES public.review_letters(id) ON DELETE SET NULL;


--
-- Name: journal_entries journal_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pending_core_needs pending_core_needs_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_core_needs
    ADD CONSTRAINT pending_core_needs_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: pending_core_needs pending_core_needs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_core_needs
    ADD CONSTRAINT pending_core_needs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: review_letters review_letters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_letters
    ADD CONSTRAINT review_letters_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: thread_entries thread_entries_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_entries
    ADD CONSTRAINT thread_entries_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: thread_entries thread_entries_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_entries
    ADD CONSTRAINT thread_entries_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: threads threads_review_letter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_review_letter_id_fkey FOREIGN KEY (review_letter_id) REFERENCES public.review_letters(id) ON DELETE SET NULL;


--
-- Name: threads threads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: user_contacts user_contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contacts
    ADD CONSTRAINT user_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_memory user_memory_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_options user_options_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_options
    ADD CONSTRAINT user_options_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_core_needs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_core_needs ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_core_needs pending_core_needs_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pending_core_needs_own ON public.pending_core_needs USING ((user_id = auth.uid()));


--
-- Name: review_letters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_letters ENABLE ROW LEVEL SECURITY;

--
-- Name: thread_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: thread_entries thread_entries_user_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_entries_user_isolation ON public.thread_entries USING ((thread_id IN ( SELECT threads.id
   FROM public.threads
  WHERE (threads.user_id = auth.uid()))));


--
-- Name: threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

--
-- Name: threads threads_user_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY threads_user_isolation ON public.threads USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: user_contacts user_contacts_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_contacts_own ON public.user_contacts USING ((user_id = auth.uid()));


--
-- Name: conversations user_conversations_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_conversations_policy ON public.conversations USING ((auth.uid() = user_id));


--
-- Name: user_memory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

--
-- Name: user_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_options ENABLE ROW LEVEL SECURITY;

--
-- Name: review_letters user_review_letters_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_review_letters_policy ON public.review_letters USING ((auth.uid() = user_id));


--
-- Name: journal_entries 用户只能创建自己的记录; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "用户只能创建自己的记录" ON public.journal_entries FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: journal_entries 用户只能删除自己的记录; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "用户只能删除自己的记录" ON public.journal_entries FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: journal_entries 用户只能更新自己的记录; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "用户只能更新自己的记录" ON public.journal_entries FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: journal_entries 用户只能查看自己的记录; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "用户只能查看自己的记录" ON public.journal_entries FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_options 用户只能管理自己的选项; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "用户只能管理自己的选项" ON public.user_options USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_memory 用户只能访问自己的记忆; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "用户只能访问自己的记忆" ON public.user_memory USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- PostgreSQL database dump complete
--


