declare module "mjml" {
  interface MjmlOutput {
    html: string;
    errors: Array<{ message: string }>;
  }
  function mjml2html(mjml: string, options?: object): MjmlOutput;
  export default mjml2html;
}
