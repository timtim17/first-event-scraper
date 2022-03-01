import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { 
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
} from 'aws-lambda';

enum FIRSTPrograms {
    FRC = 'FRC',
    FTC = 'FTC',
}

declare global {
    interface APIGatewayProxyEventPathParameters {
        program: FIRSTPrograms
        eventKey: string
    }
}

export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    const program = event.pathParameters?.program?.toUpperCase();
    const eventKey = event.pathParameters?.eventKey;

    const isProgramValid = Object.keys(FIRSTPrograms).filter(p => program == p).length > 0;
    if (!isProgramValid) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: 'Invalid program',
            }),
        };
    }

    const ddb = new DynamoDB({});
    const existingResults = await ddb.query({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: '#eventKey = :eventKey',
        ExpressionAttributeNames: {
            '#eventKey': 'EventKey',
        },
        ExpressionAttributeValues: {
            ':eventKey': {
                'S': eventKey!
            },
        },
    });

    if (existingResults.Count && existingResults.Count > 0) {
        return {
            statusCode: 200,
            body: JSON.stringify(existingResults.Items),
        };
    } else {
        if (program == FIRSTPrograms.FRC) {
            // TODO: make a request to FMS API
            return {
                statusCode: 501,
                body: JSON.stringify({
                    error: 'Not implemented',
                }),
            };
        } else {
            return {
                statusCode: 501,
                body: JSON.stringify({
                    error: 'Not implemented',
                }),
            };
        }
    }
};
