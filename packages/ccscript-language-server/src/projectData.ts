/**
 * Reference data from a CoilSnake project (the directory containing Project.snake): names of
 * items, enemies, PSI and so on from its YAML tables, which table entries point at which
 * CCScript labels, and label addresses from the last build's ccscript/summary.txt.
 *
 * CoilSnake writes these files in a regular layout, so they're read line by line, which also
 * gives line numbers for navigation.
 */

import { FileSystem } from 'ccscript-core';

/** Kinds of game data a command argument can refer to */
export type Domain = 'item' | 'character' | 'psi' | 'enemy' | 'npc' | 'teleport';

/**
 * Parameter names that identify what an argument refers to, following the conventions of
 * the standard library (e.g. `give(character, item)`, `psiname(psi)`, `warp(dest)`).
 */
const PARAMETER_DOMAINS: Record<string, Domain> = {
    item: 'item',
    char: 'character',
    character: 'character',
    psi: 'psi',
    enemy: 'enemy',
    tpt: 'npc',
    tptnum: 'npc',
    npc: 'npc',
    dest: 'teleport',
};

export function domainOfParameter(name: string): Domain | undefined {
    return Object.prototype.hasOwnProperty.call(PARAMETER_DOMAINS, name) ? PARAMETER_DOMAINS[name] : undefined;
}

export const DOMAIN_TITLES: Record<Domain, string> = {
    item: 'Item',
    character: 'Character',
    psi: 'PSI',
    enemy: 'Enemy',
    npc: 'NPC',
    teleport: 'Teleport destination',
};

/** Friendlier titles for tables that point at text */
const TABLE_TITLES: Record<string, string> = {
    item_configuration_table: 'Item',
    enemy_configuration_table: 'Enemy',
    npc_config_table: 'NPC',
    battle_action_table: 'Battle action',
    telephone_contacts_table: 'Telephone contact',
    psi_ability_table: 'PSI ability',
    store_table: 'Store',
    attract_mode_txt: 'Attract mode',
    photographer_cfg_table: 'Photographer',
    teleport_destination_table: 'Teleport destination',
    map_hotspots: 'Hotspot',
};

/** Tables whose entries are a kind of game data */
const TABLE_DOMAINS: Record<string, Domain> = {
    item_configuration_table: 'item',
    enemy_configuration_table: 'enemy',
    npc_config_table: 'npc',
    teleport_destination_table: 'teleport',
};

export function domainOfTable(file: string): Domain | undefined {
    const base = file.replace(/^.*[\\/]/, '').replace(/\.yml$/, '');
    return TABLE_DOMAINS[base];
}

export function tableTitle(file: string): string {
    const base = file.replace(/^.*[\\/]/, '').replace(/\.yml$/, '');
    return TABLE_TITLES[base] ?? base.replace(/_table$/, '').replace(/_/g, ' ');
}

export interface Entry {
    id: number;
    /** Display name, if the table has one */
    name?: string;
    /** File and (0-based) line of the entry */
    file: string;
    line: number;
    fields: Record<string, string>;
}

export interface TableReference {
    file: string;
    line: number;
    /** Table entry id, if the file is a numbered table */
    id?: number;
    field: string;
}

interface ParsedTable {
    entries: Map<number, Entry>;
}

function unquote(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replace(/''/g, "'");
    }
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function parseId(key: string): number | undefined {
    if (/^\d+$/.test(key)) return parseInt(key, 10);
    if (/^0x[0-9a-f]+$/i.test(key)) return parseInt(key, 16);
    return undefined;
}

/**
 * Read a CoilSnake table: top-level numeric keys, each with either an indented block of
 * `Field: value` lines or an inline `{Field: value, ...}` map.
 */
export function parseTable(file: string, content: string): ParsedTable {
    const entries = new Map<number, Entry>();
    let current: Entry | undefined;
    const lines = content.split(/\r?\n/);

    for (let line = 0; line < lines.length; line++) {
        const text = lines[line];
        const top = text.match(/^([^\s#][^:]*):\s*(.*)$/);
        if (top) {
            const id = parseId(top[1].trim());
            current = id === undefined ? undefined : { id, file, line, fields: {} };
            if (current) {
                entries.set(current.id, current);
                const inline = top[2].match(/^\{(.*)\}$/);
                if (inline) {
                    for (const pair of inline[1].matchAll(/([^,{}:]+):\s*([^,{}]*)/g)) {
                        current.fields[pair[1].trim()] = unquote(pair[2]);
                    }
                }
            }
            continue;
        }
        const field = current && text.match(/^ {2}([^\s-][^:]*):\s*(.*)$/);
        if (current && field) {
            current.fields[field[1].trim()] = unquote(field[2]);
        }
    }
    return { entries };
}

/**
 * Label addresses from a ccscript/summary.txt written by the compiler, keyed by `module.label`.
 */
export function parseSummary(content: string): Map<string, number> {
    const addresses = new Map<string, number>();
    let module: string | undefined;
    for (const line of content.split(/\r?\n/)) {
        const header = line.match(/^Labels in module (.+)$/);
        if (header) {
            module = header[1].trim();
            continue;
        }
        const label = module && line.match(/^(\S+)\s+\$([0-9a-fA-F]+)\s*$/);
        if (module && label && label[1] !== 'Name') {
            addresses.set(`${module}.${label[1]}`, parseInt(label[2], 16));
        }
    }
    return addresses;
}

/** Describes the text at a label, e.g. its first line of dialogue (provided by the caller) */
export type LabelTextResolver = (qualifiedLabel: string) => string | undefined;

export class ProjectData {
    private tables = new Map<string, Promise<ParsedTable | undefined>>();
    private references: Promise<Map<string, TableReference[]>> | undefined;
    private summary: Promise<Map<string, number>> | undefined;

    constructor(readonly root: string, private readonly fs: FileSystem) { }

    private path(...parts: string[]): string {
        return this.fs.join(this.root, ...parts);
    }

    private async read(path: string): Promise<string | undefined> {
        try {
            return await this.fs.exists(path) ? await this.fs.readFile(path) : undefined;
        } catch {
            return undefined;
        }
    }

    private table(file: string): Promise<ParsedTable | undefined> {
        let table = this.tables.get(file);
        if (!table) {
            const path = this.path(file);
            table = this.read(path).then(content => content === undefined ? undefined : parseTable(path, content));
            this.tables.set(file, table);
        }
        return table;
    }

    /**
     * Entries of a kind of game data, with names where the project has them.
     */
    async entries(domain: Domain, describeLabel?: LabelTextResolver): Promise<Entry[]> {
        const named = async (file: string, field: string) => {
            const table = await this.table(file);
            return table ? [...table.entries.values()].map(e => ({ ...e, name: e.fields[field]?.trim() || undefined })) : [];
        };

        switch (domain) {
            case 'item': return named('item_configuration_table.yml', 'Name');
            case 'enemy': return named('enemy_configuration_table.yml', 'Name');
            case 'psi': return named('psi_name_table.yml', 'Name');
            case 'character': {
                // Party members 1-4 are named on the naming screen (the first "don't care" name)
                const table = await this.table('dont_care_names.yml');
                return table
                    ? [...table.entries.values()].filter(e => e.id < 4)
                        .map(e => ({ ...e, id: e.id + 1, name: e.fields['Name 1']?.trim() || undefined }))
                    : [];
            }
            case 'teleport': {
                const table = await this.table('teleport_destination_table.yml');
                return table
                    ? [...table.entries.values()].map(e => {
                        const comment = e.fields['EBME_Comment'];
                        return { ...e, name: comment && comment !== 'null' ? comment : undefined };
                    })
                    : [];
            }
            case 'npc': {
                // NPCs aren't named; describe them by what they say
                const table = await this.table('npc_config_table.yml');
                return table
                    ? [...table.entries.values()].map(e => {
                        const pointer = e.fields['Text Pointer 1'];
                        const text = pointer && describeLabel ? describeLabel(pointer) : undefined;
                        return { ...e, name: text };
                    })
                    : [];
            }
        }
    }

    async entry(domain: Domain, id: number, describeLabel?: LabelTextResolver): Promise<Entry | undefined> {
        if (domain === 'npc') {
            // Describe just this one
            const entry = (await this.table('npc_config_table.yml'))?.entries.get(id);
            const pointer = entry?.fields['Text Pointer 1'];
            return entry && { ...entry, name: pointer && describeLabel ? describeLabel(pointer) : undefined };
        }
        return (await this.entries(domain, describeLabel)).find(e => e.id === id);
    }

    /**
     * Table fields that point at a label, keyed by `module.label` (as tables write them).
     */
    tableReferences(): Promise<Map<string, TableReference[]>> {
        this.references ??= (async () => {
            const references = new Map<string, TableReference[]>();
            const files = (await this.fs.readDirectory(this.root)).filter(f => f.toLowerCase().endsWith('.yml'));
            for (const file of files) {
                const content = await this.read(file);
                if (content === undefined) continue;
                let id: number | undefined;
                const lines = content.split(/\r?\n/);
                for (let line = 0; line < lines.length; line++) {
                    const text = lines[line];
                    const top = text.match(/^([^\s#][^:]*):/);
                    if (top) id = parseId(top[1].trim());
                    // `Field: module.label`, possibly inside an inline map
                    for (const match of text.matchAll(/([A-Za-z][\w ]*):\s*([A-Za-z_]\w*\.[A-Za-z_]\w*)(?=\s*[,}]|\s*$)/g)) {
                        const reference = { file, line, id, field: match[1].trim() };
                        const list = references.get(match[2]);
                        if (list) list.push(reference); else references.set(match[2], [reference]);
                    }
                }
            }
            return references;
        })();
        return this.references;
    }

    labelAddresses(): Promise<Map<string, number>> {
        this.summary ??= this.read(this.path('ccscript', 'summary.txt'))
            .then(content => content === undefined ? new Map<string, number>() : parseSummary(content));
        return this.summary;
    }

    /**
     * Forget cached data after project files change.
     */
    invalidate(): void {
        this.tables.clear();
        this.references = undefined;
        this.summary = undefined;
    }
}

/**
 * Finds and caches the CoilSnake project for files.
 */
export class ProjectCatalog {
    private readonly projects = new Map<string, ProjectData>();
    private readonly roots = new Map<string, Promise<string | undefined>>();

    constructor(private readonly fs: FileSystem) { }

    /**
     * The project containing a file: the nearest ancestor directory with a Project.snake.
     */
    async forFile(filePath: string): Promise<ProjectData | undefined> {
        const root = await this.findRoot(this.fs.dirname(filePath));
        if (!root) return undefined;
        let project = this.projects.get(root);
        if (!project) {
            project = new ProjectData(root, this.fs);
            this.projects.set(root, project);
        }
        return project;
    }

    private findRoot(dir: string): Promise<string | undefined> {
        let root = this.roots.get(dir);
        if (!root) {
            root = (async () => {
                if (await this.fs.exists(this.fs.join(dir, 'Project.snake'))) return dir;
                const parent = this.fs.dirname(dir);
                return parent === dir ? undefined : this.findRoot(parent);
            })();
            this.roots.set(dir, root);
        }
        return root;
    }

    /**
     * Forget cached data for a changed project file (a table, summary.txt or Project.snake).
     */
    fileChanged(filePath: string): void {
        if (filePath.endsWith('Project.snake')) {
            this.roots.clear();
        }
        for (const project of this.projects.values()) {
            if (filePath.startsWith(project.root)) {
                project.invalidate();
            }
        }
    }
}
