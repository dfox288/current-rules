type Sql = import('postgres').Sql;
export interface TestSchema {
    /** The connection URL pinned to the schema through `search_path`. */
    url: string;
    schema: string;
    /** A client on the schema. Closed by `drop()`. */
    sql: Sql;
    drop(): Promise<void>;
}
export declare function testDatabaseUrl(): string;
/** A new empty schema. `scope` says when it is dropped: after the test (default) or at file end. */
export declare function openTestSchema(options?: {
    scope?: 'test' | 'file';
    prefix?: string;
}): Promise<TestSchema>;
export declare const dropTestSchemas: () => Promise<void>;
export declare function dropFileSchemas(): Promise<void>;
export {};
