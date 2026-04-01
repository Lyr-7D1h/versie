declare const tags: unique symbol
export type Tagged<BaseType, Tag extends PropertyKey> = BaseType & {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  [tags]: { [K in Tag]: void }
}
