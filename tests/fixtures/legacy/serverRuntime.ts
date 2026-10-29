let adapter: { hashPassword: (value: string) => string } | undefined;
export const configureServerRuntime = (value: typeof adapter) => {
  adapter = value;
};
export const getServerRuntime = () => adapter;

