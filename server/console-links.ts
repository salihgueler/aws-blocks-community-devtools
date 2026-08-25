/**
 * Deep links from a CloudFormation resource to its page in the AWS console.
 *
 * Two deliberate limits:
 * - Only types with a genuinely useful console page are mapped. A stack holds
 *   plenty of resources (IAM policies, Lambda permissions, custom resources,
 *   CDK metadata) whose console page is either nonexistent or useless, and a
 *   confident-looking link to nothing is worse than no link.
 * - Everything unmapped falls back to the stack's own Resources tab, which
 *   always exists and links onward. So every row has somewhere to go.
 *
 * These URL shapes are best-effort: the console's routes are not a contract and
 * change over time. The fallback is what keeps a stale pattern from becoming a
 * dead end.
 */

export interface ConsoleLink {
  url: string;
  /** false when this is the stack fallback rather than the resource's own page */
  direct: boolean;
}

const GLOBAL_CONSOLE = "https://console.aws.amazon.com";
const regional = (region: string) => `https://${region}.console.aws.amazon.com`;

export function consoleLink(
  resourceType: string,
  physicalId: string,
  region: string,
  stackName: string,
): ConsoleLink {
  const direct = directLink(resourceType, physicalId, region);
  if (direct) return { url: direct, direct: true };
  return { url: stackResourcesUrl(stackName, region), direct: false };
}

/** The stack's Resources tab — always valid, lists everything, links onward. */
export function stackResourcesUrl(stackName: string, region: string): string {
  return `${regional(region)}/cloudformation/home?region=${region}#/stacks/resources?stackName=${encodeURIComponent(stackName)}`;
}

function directLink(type: string, id: string, region: string): string | null {
  const r = regional(region);
  const q = `?region=${region}`;
  switch (type) {
    case "AWS::DynamoDB::Table":
      return `${r}/dynamodbv2/home${q}#table?name=${encodeURIComponent(id)}`;
    case "AWS::Lambda::Function":
      return `${r}/lambda/home${q}#/functions/${encodeURIComponent(id)}`;
    case "AWS::Cognito::UserPool":
      return `${r}/cognito/v2/idp/user-pools/${encodeURIComponent(id)}/users${q}`;
    case "AWS::S3::Bucket":
      return `${r}/s3/buckets/${encodeURIComponent(id)}${q}`;
    case "AWS::CloudFront::Distribution":
      // CloudFront is global — a region qualifier would be misleading.
      return `${GLOBAL_CONSOLE}/cloudfront/v4/home#/distributions/${encodeURIComponent(id)}`;
    case "AWS::ApiGateway::RestApi":
      return `${r}/apigateway/main/apis/${encodeURIComponent(id)}/resources${q}`;
    case "AWS::ApiGatewayV2::Api":
      return `${r}/apigateway/main/api-detail${q}&api=${encodeURIComponent(id)}`;
    case "AWS::SQS::Queue":
      // PhysicalResourceId for a queue is its URL.
      return `${r}/sqs/v3/home${q}#/queues/${encodeURIComponent(id)}`;
    case "AWS::SNS::Topic":
      return `${r}/sns/v3/home${q}#/topic/${encodeURIComponent(id)}`;
    case "AWS::Logs::LogGroup":
      return `${r}/cloudwatch/home${q}#logsV2:log-groups/log-group/${encodeURIComponent(id).replace(/%2F/g, "$252F")}`;
    case "AWS::StepFunctions::StateMachine":
      return `${r}/states/home${q}#/statemachines/view/${encodeURIComponent(id)}`;
    case "AWS::Events::Rule":
      return `${r}/events/home${q}#/eventbus/default/rules/${encodeURIComponent(id)}`;
    case "AWS::SecretsManager::Secret":
      return `${r}/secretsmanager/secret?name=${encodeURIComponent(id)}&region=${region}`;
    case "AWS::SSM::Parameter":
      return `${r}/systems-manager/parameters/${encodeURIComponent(id)}/description${q}`;
    case "AWS::IAM::Role":
      // IAM is global; the physical id is the role name.
      return `${GLOBAL_CONSOLE}/iam/home#/roles/${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

/** Human label for a resource type: "AWS::DynamoDB::Table" -> "DynamoDB Table". */
export function friendlyType(resourceType: string): string {
  const parts = resourceType.split("::");
  if (parts.length < 3) return resourceType;
  return `${parts[1]} ${parts.slice(2).join(" ")}`;
}
