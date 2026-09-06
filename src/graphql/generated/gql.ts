/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "query HomeLineup($season: Int!) {\n  driverStandings(season: $season) {\n    position\n    points\n    driver {\n      code\n      name\n      number\n    }\n    team {\n      name\n      color\n    }\n  }\n}": typeof types.HomeLineupDocument,
    "query RaceLibrary($season: Int, $search: String, $first: Int, $after: String) {\n  races(season: $season, search: $search, first: $first, after: $after) {\n    edges {\n      cursor\n      node {\n        id\n        slug\n        date\n        laps\n        type\n        isFeatured\n        meeting {\n          name\n          country\n          circuitName\n          round\n          season\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n  seasons {\n    year\n  }\n}\n\nquery RaceHeader($slug: String!) {\n  race(slug: $slug) {\n    id\n    slug\n    date\n    laps\n    type\n    meeting {\n      name\n      country\n      circuitName\n      round\n      season\n      weather\n    }\n    results {\n      finalPosition\n      lapsCompleted\n      points\n      status\n      fastestLap\n      driver {\n        code\n        name\n        number\n      }\n      team {\n        name\n        color\n      }\n    }\n  }\n}\n\nquery RaceSlugs($first: Int) {\n  races(first: $first) {\n    edges {\n      node {\n        slug\n      }\n    }\n  }\n}": typeof types.RaceLibraryDocument,
};
const documents: Documents = {
    "query HomeLineup($season: Int!) {\n  driverStandings(season: $season) {\n    position\n    points\n    driver {\n      code\n      name\n      number\n    }\n    team {\n      name\n      color\n    }\n  }\n}": types.HomeLineupDocument,
    "query RaceLibrary($season: Int, $search: String, $first: Int, $after: String) {\n  races(season: $season, search: $search, first: $first, after: $after) {\n    edges {\n      cursor\n      node {\n        id\n        slug\n        date\n        laps\n        type\n        isFeatured\n        meeting {\n          name\n          country\n          circuitName\n          round\n          season\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n  seasons {\n    year\n  }\n}\n\nquery RaceHeader($slug: String!) {\n  race(slug: $slug) {\n    id\n    slug\n    date\n    laps\n    type\n    meeting {\n      name\n      country\n      circuitName\n      round\n      season\n      weather\n    }\n    results {\n      finalPosition\n      lapsCompleted\n      points\n      status\n      fastestLap\n      driver {\n        code\n        name\n        number\n      }\n      team {\n        name\n        color\n      }\n    }\n  }\n}\n\nquery RaceSlugs($first: Int) {\n  races(first: $first) {\n    edges {\n      node {\n        slug\n      }\n    }\n  }\n}": types.RaceLibraryDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query HomeLineup($season: Int!) {\n  driverStandings(season: $season) {\n    position\n    points\n    driver {\n      code\n      name\n      number\n    }\n    team {\n      name\n      color\n    }\n  }\n}"): (typeof documents)["query HomeLineup($season: Int!) {\n  driverStandings(season: $season) {\n    position\n    points\n    driver {\n      code\n      name\n      number\n    }\n    team {\n      name\n      color\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query RaceLibrary($season: Int, $search: String, $first: Int, $after: String) {\n  races(season: $season, search: $search, first: $first, after: $after) {\n    edges {\n      cursor\n      node {\n        id\n        slug\n        date\n        laps\n        type\n        isFeatured\n        meeting {\n          name\n          country\n          circuitName\n          round\n          season\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n  seasons {\n    year\n  }\n}\n\nquery RaceHeader($slug: String!) {\n  race(slug: $slug) {\n    id\n    slug\n    date\n    laps\n    type\n    meeting {\n      name\n      country\n      circuitName\n      round\n      season\n      weather\n    }\n    results {\n      finalPosition\n      lapsCompleted\n      points\n      status\n      fastestLap\n      driver {\n        code\n        name\n        number\n      }\n      team {\n        name\n        color\n      }\n    }\n  }\n}\n\nquery RaceSlugs($first: Int) {\n  races(first: $first) {\n    edges {\n      node {\n        slug\n      }\n    }\n  }\n}"): (typeof documents)["query RaceLibrary($season: Int, $search: String, $first: Int, $after: String) {\n  races(season: $season, search: $search, first: $first, after: $after) {\n    edges {\n      cursor\n      node {\n        id\n        slug\n        date\n        laps\n        type\n        isFeatured\n        meeting {\n          name\n          country\n          circuitName\n          round\n          season\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n  seasons {\n    year\n  }\n}\n\nquery RaceHeader($slug: String!) {\n  race(slug: $slug) {\n    id\n    slug\n    date\n    laps\n    type\n    meeting {\n      name\n      country\n      circuitName\n      round\n      season\n      weather\n    }\n    results {\n      finalPosition\n      lapsCompleted\n      points\n      status\n      fastestLap\n      driver {\n        code\n        name\n        number\n      }\n      team {\n        name\n        color\n      }\n    }\n  }\n}\n\nquery RaceSlugs($first: Int) {\n  races(first: $first) {\n    edges {\n      node {\n        slug\n      }\n    }\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;