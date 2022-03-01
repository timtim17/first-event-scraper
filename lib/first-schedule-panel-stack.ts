import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

import { join } from 'path';

import * as dotenv from 'dotenv';
import { assert } from 'console';

dotenv.config();
const FRC_API_KEY = process.env.FRC_API_KEY as string;
assert(FRC_API_KEY, 'Missing FRC API key.');

export class FirstSchedulePanelStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const iamRole = new iam.Role(this, 'EventHistoryRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    const table = new dynamodb.Table(this, 'EventDB', {
        partitionKey: { name: 'EventKey', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'MatchNum', type: dynamodb.AttributeType.NUMBER },
        billingMode: dynamodb.BillingMode.PROVISIONED,
        readCapacity: 5,    // TODO: actually figure out proper numbers
        writeCapacity: 2,
    });
    table.grantReadWriteData(iamRole);

    const lambda = new NodejsFunction(this, 'GetEventHistory', {
        entry: join(__dirname, '../src/lambda/index.ts'),
        environment: {
            FRC_API_KEY,
        },
        role: iamRole,
        logRetention: logs.RetentionDays.ONE_WEEK,
    })

    const api = new apigw.LambdaRestApi(this, 'EventHistoryEndpoint', {
        handler: lambda,
        proxy: false,
    });
    const program = api.root.addResource('{program}');
    const event = program.addResource('{eventKey}');
    event.addMethod('GET');
  }
}
