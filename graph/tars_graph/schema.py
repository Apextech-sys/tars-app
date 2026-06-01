"""
TARS knowledge graph — entity + edge type definitions (v2).

Key change from v1: `customer` was the wrong frame. The real classification
is:
- `business` — which internal business/product line a project belongs to
  (freshbark, wondernet, konverge, apex, apex-poc, plus "shaun" for personal)
- `visibility` — personal | work (firewall for external posting)

Partners (P45, agencies, etc.) are first-class entities, NOT customers.
A Project --[CONTRIBUTED_BY]--> Partner edge captures dev-contractor work.

Trust model:
- group_id='discovered' = trusted, populated from authoritative sources
  (GitHub/Linear/Vercel/Supabase/Slack APIs + ~/.tars-state/knowledge/*.yaml)
- group_id='inferred' = soft, reserved for any future LLM extraction;
  never used by synthesis.
"""
from typing import Literal
from pydantic import BaseModel, Field


# ===== ENTITY TYPES =====

class Project(BaseModel):
    """A unit of work — product, client engagement, infra, or sandbox."""
    name: str = Field(description='Canonical project name (lowercase-hyphenated)')
    kind: Literal['product', 'client', 'infra', 'sandbox'] = Field(description='What kind of work this is')
    visibility: Literal['personal', 'work'] = Field(description='personal = never posted externally; work = OK to post')
    business: str = Field(description='Internal business code (freshbark, wondernet, konverge, apex, apex-poc, shaun)')
    description: str = Field(default='', description='One-line summary')


class Repo(BaseModel):
    """A GitHub repository."""
    full_name: str = Field(description='org/repo')
    default_branch: str = Field(default='main')
    archived: bool = Field(default=False)
    language: str = Field(default='')


class Partner(BaseModel):
    """A 3rd-party partner — dev contractor, agency, integrator, supplier.
    Distinct from Customer (we don't model customers as nodes; the business
    code on a Project carries that information)."""
    code: str = Field(description='Short partner code (p45, etc.)')
    kind: Literal['dev-contractor', 'agency', 'integrator', 'supplier', 'other'] = Field(default='other')
    display_name: str = Field(default='')


class Person(BaseModel):
    """A human — Shaun, P45 contacts, internal team."""
    email: str = Field(default='')
    display_name: str = Field(description='Display name')
    role: str = Field(default='')


class SlackChannel(BaseModel):
    channel_id: str = Field(description='Slack channel ID')
    name: str = Field(description='Channel name with leading #')
    is_connect: bool = Field(default=False)


class LinearTeam(BaseModel):
    key: str = Field(description='Linear team key (e.g. REF, P45, PLA)')
    name: str = Field(description='Display name')


class VercelProject(BaseModel):
    project_id: str = Field(description='Vercel project ID')
    name: str


class SupabaseProject(BaseModel):
    project_ref: str = Field(description='Supabase project ref')
    name: str


class AWSAccount(BaseModel):
    """An AWS account (we may have several — prod, staging, etc.)."""
    account_id: str = Field(description='12-digit AWS account ID')
    alias: str = Field(default='', description='friendly alias')


class NotionWorkspace(BaseModel):
    workspace_id: str = Field(default='')
    name: str


class MondayBoard(BaseModel):
    """A monday.com board."""
    board_id: str = Field(description='Monday board ID')
    name: str
    workspace_id: str = Field(default='')


class MondayWorkspace(BaseModel):
    """A monday.com workspace."""
    workspace_id: str = Field(description='Monday workspace ID')
    name: str


class Domain(BaseModel):
    fqdn: str


class Service(BaseModel):
    name: str = Field(description='Service name (cloudflare, snyk, etc.)')


# ===== EDGE TYPES =====

class Owns(BaseModel):
    """Project OWNS Repo."""
    since: str = Field(default='')


class ContributedBy(BaseModel):
    """Project CONTRIBUTED_BY Partner — captures dev-contractor relationships."""
    role: str = Field(default='dev')


class DeploysTo(BaseModel):
    """Project DEPLOYS_TO VercelProject / AWSAccount / Service."""
    environment: str = Field(default='production')


class DiscussedIn(BaseModel):
    """Project DISCUSSED_IN SlackChannel."""
    primary: bool = Field(default=True)


class TrackedIn(BaseModel):
    """Project TRACKED_IN LinearTeam."""
    pass


class UsesService(BaseModel):
    """Project USES_SERVICE Supabase/AWS/Cloudflare/etc."""
    purpose: str = Field(default='')


class ServedAt(BaseModel):
    """Project SERVED_AT Domain (production domains)."""
    pass


class DocumentedIn(BaseModel):
    """Project DOCUMENTED_IN NotionWorkspace."""
    pass


ENTITY_TYPES = {
    'Project': Project,
    'Repo': Repo,
    'Partner': Partner,
    'Person': Person,
    'SlackChannel': SlackChannel,
    'LinearTeam': LinearTeam,
    'VercelProject': VercelProject,
    'SupabaseProject': SupabaseProject,
    'AWSAccount': AWSAccount,
    'NotionWorkspace': NotionWorkspace,
    'MondayBoard': MondayBoard,
    'MondayWorkspace': MondayWorkspace,
    'Domain': Domain,
    'Service': Service,
}

EDGE_TYPES = {
    'OWNS': Owns,
    'CONTRIBUTED_BY': ContributedBy,
    'DEPLOYS_TO': DeploysTo,
    'DISCUSSED_IN': DiscussedIn,
    'TRACKED_IN': TrackedIn,
    'USES_SERVICE': UsesService,
    'SERVED_AT': ServedAt,
    'DOCUMENTED_IN': DocumentedIn,
}

VALID_SOURCES = {
    'github', 'linear', 'vercel', 'supabase', 'slack', 'cloudflare',
    'knowledge-yaml',     # ~/.tars-state/knowledge/*.yaml — primary source for project metadata
    'manual',             # ad-hoc agent/skill writes
    'test-seed',
}

VALID_BUSINESSES = {
    'freshbark', 'wondernet', 'konverge', 'apex', 'apex-poc',
    'shaun',                                  # personal projects bucket
    'household-os', 'ubuntushield',           # one-off personal product names that also serve as 'business'
    'trinova', 'polymarket', 'crypto-predictor', 'alphabet-soup',
}
