"""TARS knowledge graph — public API (v2).

Usage:
    from tars_graph import TarsGraph
    async with TarsGraph() as g:
        project = await g.get('Project', 'freshbark')
        related = await g.related_to('freshbark')
        personal = await g.projects_by_visibility('personal')
"""
from .client import TarsGraph, DISCOVERED, INFERRED, DEFAULT_DB_PATH
from .schema import (
    Project, Repo, Partner, Person,
    SlackChannel, LinearTeam, VercelProject, SupabaseProject,
    AWSAccount, NotionWorkspace, MondayBoard, MondayWorkspace,
    Domain, Service,
    Owns, ContributedBy, DeploysTo, DiscussedIn, TrackedIn,
    UsesService, ServedAt, DocumentedIn,
    ENTITY_TYPES, EDGE_TYPES, VALID_SOURCES, VALID_BUSINESSES,
)

__all__ = [
    'TarsGraph', 'DISCOVERED', 'INFERRED', 'DEFAULT_DB_PATH',
    'Project', 'Repo', 'Partner', 'Person',
    'SlackChannel', 'LinearTeam', 'VercelProject', 'SupabaseProject',
    'AWSAccount', 'NotionWorkspace', 'MondayBoard', 'MondayWorkspace',
    'Domain', 'Service',
    'Owns', 'ContributedBy', 'DeploysTo', 'DiscussedIn', 'TrackedIn',
    'UsesService', 'ServedAt', 'DocumentedIn',
    'ENTITY_TYPES', 'EDGE_TYPES', 'VALID_SOURCES', 'VALID_BUSINESSES',
]
